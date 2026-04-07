import { randomUUID } from "node:crypto";

import { and, desc, eq, gt } from "drizzle-orm";
import { createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { sepolia } from "viem/chains";

import {
  DEFAULT_RPC_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_NAME,
} from "@/lib/constants";
import { env } from "@/lib/env";
import type {
  PendingWalletAction,
  PermissionGrant,
  PermissionGrantInput,
  SwapActionMetadata,
  WalletContext,
} from "@/lib/types";
import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/init";
import {
  chatMessages,
  pendingActions,
  permissionGrants,
} from "@/server/db/schema";
import { PolicyService } from "@/server/services/policy-service";
import { TokenBalanceService } from "@/server/services/token-balance-service";
import { UniswapTradeService } from "@/server/services/uniswap-trade-service";

interface SessionShape {
  id: string;
  address: string;
}

interface TransferIntent {
  toAddress: string;
  amountEth: string;
  reason?: string;
}

interface SwapIntent {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  reason?: string;
}

export class WaapWalletService {
  constructor(
    private readonly policyService = new PolicyService(),
    private readonly tokenBalanceService = new TokenBalanceService(),
    private readonly uniswapTradeService = new UniswapTradeService(),
  ) {}

  private readonly publicClient = createPublicClient({
    chain: sepolia,
    transport: http(env.SEPOLIA_RPC_URL || DEFAULT_RPC_URL),
  });

  async getNativeBalance(address: string) {
    const value = await this.publicClient.getBalance({
      address: getAddress(address),
    });

    return {
      nativeBalanceWei: value.toString(),
      nativeBalanceEth: formatEther(value),
    };
  }

  async getWalletContext(session: SessionShape): Promise<WalletContext> {
    ensureDatabase();

    const balance = await this.getNativeBalance(session.address);
    const tokenBalances = await this.tokenBalanceService
      .getTokenBalances(session.address)
      .catch(() => []);
    const activePermission = this.getActivePermissionGrant(session.id);
    const recentActions = this.listRecentActions(session.id);

    return {
      address: session.address,
      chainId: SEPOLIA_CHAIN_ID,
      chainName: SEPOLIA_CHAIN_NAME,
      nativeBalanceWei: balance.nativeBalanceWei,
      nativeBalanceEth: balance.nativeBalanceEth,
      tokenBalances,
      swapAvailable: this.uniswapTradeService.isConfigured(),
      activePermission,
      recentActions,
    };
  }

  createTransferPreview(session: SessionShape, intent: TransferIntent) {
    const valueWei = parseEther(intent.amountEth).toString();
    const estimatedValueUsd = this.policyService.estimateUsdFromWei(valueWei);
    const validated = this.policyService.assertTransferInput({
      toAddress: intent.toAddress,
      valueWei,
      estimatedValueUsd,
    });

    return {
      chainId: SEPOLIA_CHAIN_ID,
      fromAddress: session.address,
      toAddress: validated.toAddress,
      valueWei: validated.valueWei,
      valueEth: intent.amountEth,
      estimatedValueUsd,
      summary: `Send ${intent.amountEth} ETH to ${validated.toAddress} on Sepolia.`,
      reason: intent.reason ?? null,
    };
  }

  async createSwapPreview(session: SessionShape, intent: SwapIntent) {
    const quote = await this.uniswapTradeService.createExactInputSwap({
      walletAddress: session.address,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amount: intent.amount,
    });

    const validated = this.policyService.assertSwapInput({
      quoteTargetAddress: quote.swapTx.to,
      tokenIn: quote.tokenIn.symbol,
      tokenOut: quote.tokenOut.symbol,
      estimatedValueUsd: quote.estimatedValueUsd,
      slippageBps: quote.slippageBps,
    });

    const metadata: SwapActionMetadata = {
      kind: "token_swap",
      protocol: "uniswap",
      tokenInSymbol: quote.tokenIn.symbol,
      tokenInAddress: quote.tokenIn.address,
      tokenInDecimals: quote.tokenIn.decimals,
      tokenOutSymbol: quote.tokenOut.symbol,
      tokenOutAddress: quote.tokenOut.address,
      tokenOutDecimals: quote.tokenOut.decimals,
      amountInRaw: quote.amountInRaw,
      amountInDisplay: quote.amountInDisplay,
      quotedAmountOutRaw: quote.quotedAmountOutRaw,
      quotedAmountOutDisplay: quote.quotedAmountOutDisplay,
      quoteId: quote.quoteId,
      routeString: quote.routeString,
      approvalTx: quote.approvalTx,
      swapTx: quote.swapTx,
    };

    return {
      chainId: SEPOLIA_CHAIN_ID,
      routerAddress: validated.targetAddress,
      valueWei: quote.swapTx.value ?? "0",
      estimatedValueUsd: validated.estimatedValueUsd,
      summary: `Swap ${quote.amountInDisplay} ${quote.tokenIn.symbol} for about ${quote.quotedAmountOutDisplay} ${quote.tokenOut.symbol} on Sepolia.`,
      reason: intent.reason ?? null,
      metadata,
    };
  }

  async createPendingTransfer(session: SessionShape, intent: TransferIntent) {
    ensureDatabase();

    const preview = this.createTransferPreview(session, intent);
    const activePermission = this.getActivePermissionGrant(session.id);
    const now = Date.now();

    const draft = {
      id: randomUUID(),
      sessionId: session.id,
      permissionGrantId: null,
      type: "native_transfer",
      status: "needs_approval",
      chainId: SEPOLIA_CHAIN_ID,
      toAddress: preview.toAddress,
      valueWei: preview.valueWei,
      estimatedValueUsd: preview.estimatedValueUsd,
      summary: preview.summary,
      reason: preview.reason,
      requiresPermission: true,
      canAutoExecute: false,
      txHash: null,
      error: null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    } as const;

    const action = this.mapPendingActionRow(draft);
    const canAutoExecute = this.policyService.isGrantValidForAction(
      activePermission,
      action,
    );

    getDb()
      .insert(pendingActions)
      .values({
        ...draft,
        status: canAutoExecute ? "ready" : "needs_approval",
        requiresPermission: !canAutoExecute,
        canAutoExecute,
        permissionGrantId: canAutoExecute ? activePermission?.id ?? null : null,
      })
      .run();

    return this.getAction(session.id, draft.id);
  }

  async createPendingSwap(session: SessionShape, intent: SwapIntent) {
    ensureDatabase();

    const preview = await this.createSwapPreview(session, intent);
    const activePermission = this.getActivePermissionGrant(session.id);
    const now = Date.now();

    const draft = {
      id: randomUUID(),
      sessionId: session.id,
      permissionGrantId: null,
      type: "token_swap",
      status: "needs_approval",
      chainId: SEPOLIA_CHAIN_ID,
      toAddress: preview.routerAddress,
      valueWei: preview.valueWei,
      estimatedValueUsd: preview.estimatedValueUsd,
      summary: preview.summary,
      reason: preview.reason,
      requiresPermission: true,
      canAutoExecute: false,
      txHash: null,
      error: null,
      metadata: JSON.stringify(preview.metadata),
      createdAt: now,
      updatedAt: now,
    } as const;

    const action = this.mapPendingActionRow(draft);
    const canAutoExecute = this.policyService.isGrantValidForAction(
      activePermission,
      action,
    );

    getDb()
      .insert(pendingActions)
      .values({
        ...draft,
        status: canAutoExecute ? "ready" : "needs_approval",
        requiresPermission: !canAutoExecute,
        canAutoExecute,
        permissionGrantId: canAutoExecute ? activePermission?.id ?? null : null,
      })
      .run();

    return this.getAction(session.id, draft.id);
  }

  recordMessage(sessionId: string, role: "user" | "assistant", content: string) {
    ensureDatabase();

    getDb()
      .insert(chatMessages)
      .values({
        id: randomUUID(),
        sessionId,
        role,
        content,
        metadata: null,
        createdAt: Date.now(),
      })
      .run();
  }

  getRecentMessages(sessionId: string, limit = 10) {
    ensureDatabase();

    const rows = getDb()
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)
      .all();

    return rows
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        createdAt: new Date(row.createdAt).toISOString(),
      }));
  }

  recordPermissionGrant(sessionId: string, input: PermissionGrantInput) {
    ensureDatabase();

    const now = Date.now();
    const expiresAt = now + input.requestedExpirySeconds * 1000;
    const id = randomUUID();

    getDb()
      .insert(permissionGrants)
      .values({
        id,
        sessionId,
        chainId: input.chainId,
        actionType: input.actionType,
        allowedAddresses: JSON.stringify(input.allowedAddresses),
        maxAmountUsd: input.maxAmountUsd,
        createdAt: now,
        expiresAt,
        status: "active",
      })
      .run();

    return this.getGrantById(id);
  }

  getGrantById(id: string): PermissionGrant | null {
    ensureDatabase();

    const row = getDb()
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.id, id))
      .get();

    return row ? this.mapGrantRow(row) : null;
  }

  getActivePermissionGrant(sessionId: string) {
    ensureDatabase();

    const now = Date.now();
    const row = getDb()
      .select()
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.sessionId, sessionId),
          eq(permissionGrants.status, "active"),
          gt(permissionGrants.expiresAt, now),
        ),
      )
      .orderBy(desc(permissionGrants.createdAt))
      .get();

    return row ? this.mapGrantRow(row) : null;
  }

  confirmAction(sessionId: string, actionId: string) {
    ensureDatabase();

    const action = this.getAction(sessionId, actionId);

    if (!action) {
      throw new Error("Action not found.");
    }

    const grant = this.getActivePermissionGrant(sessionId);
    const canAutoExecute = this.policyService.isGrantValidForAction(grant, action);

    if (!canAutoExecute) {
      throw new Error("No active permission grant covers this action.");
    }

    getDb()
      .update(pendingActions)
      .set({
        status: "ready",
        requiresPermission: false,
        canAutoExecute: true,
        permissionGrantId: grant?.id ?? null,
        updatedAt: Date.now(),
      })
      .where(eq(pendingActions.id, actionId))
      .run();

    return this.getAction(sessionId, actionId);
  }

  completeAction(
    sessionId: string,
    actionId: string,
    result: { status: "completed" | "failed"; txHash?: string; error?: string },
  ) {
    ensureDatabase();

    const action = this.getAction(sessionId, actionId);

    if (!action) {
      throw new Error("Action not found.");
    }

    getDb()
      .update(pendingActions)
      .set({
        status: result.status,
        txHash: result.txHash ?? null,
        error: result.error ?? null,
        updatedAt: Date.now(),
      })
      .where(eq(pendingActions.id, actionId))
      .run();

    return this.getAction(sessionId, actionId);
  }

  getAction(sessionId: string, actionId: string) {
    ensureDatabase();

    const row = getDb()
      .select()
      .from(pendingActions)
      .where(
        and(eq(pendingActions.id, actionId), eq(pendingActions.sessionId, sessionId)),
      )
      .get();

    return row ? this.mapPendingActionRow(row) : null;
  }

  listRecentActions(sessionId: string, limit = 6) {
    ensureDatabase();

    return getDb()
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.sessionId, sessionId))
      .orderBy(desc(pendingActions.createdAt))
      .limit(limit)
      .all()
      .map((row) => this.mapPendingActionRow(row));
  }

  private mapGrantRow(row: typeof permissionGrants.$inferSelect): PermissionGrant {
    return {
      id: row.id,
      chainId: row.chainId,
      actionType: row.actionType as PermissionGrant["actionType"],
      allowedAddresses: JSON.parse(row.allowedAddresses) as string[],
      maxAmountUsd: row.maxAmountUsd,
      expiresAt: new Date(row.expiresAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
      status:
        row.status === "active" && row.expiresAt > Date.now() ? "active" : "expired",
    };
  }

  private mapPendingActionRow(
    row: typeof pendingActions.$inferSelect | {
      id: string;
      permissionGrantId: string | null;
      type: string;
      status: string;
      chainId: number;
      toAddress: string;
      valueWei: string;
      estimatedValueUsd: string;
      summary: string;
      reason: string | null;
      requiresPermission: boolean;
      canAutoExecute: boolean;
      txHash: string | null;
      error: string | null;
      metadata: string | null;
      createdAt: number;
      updatedAt: number;
    },
  ): PendingWalletAction {
    return {
      id: row.id,
      type: row.type as PendingWalletAction["type"],
      status: row.status as PendingWalletAction["status"],
      chainId: row.chainId,
      toAddress: getAddress(row.toAddress),
      valueWei: row.valueWei,
      valueEth: formatEther(BigInt(row.valueWei)),
      estimatedValueUsd: row.estimatedValueUsd,
      summary: row.summary,
      reason: row.reason,
      requiresPermission: row.requiresPermission,
      canAutoExecute: row.canAutoExecute,
      txHash: row.txHash,
      error: row.error,
      permissionGrantId: row.permissionGrantId,
      metadata: row.metadata ? (JSON.parse(row.metadata) as SwapActionMetadata) : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
