import { describe, expect, test } from "bun:test";

import type { ChatResponse, PendingWalletAction, WalletContext } from "@/lib/types";
import {
  handleActionDraftRequest,
  handleAuthChallengeRequest,
  handleAuthVerifyRequest,
  handleChatRequest,
  handleConfirmActionRequest,
  handleWalletContextRequest,
  handlePermissionGrantRequest,
} from "@/server/api/handlers";

const session = {
  id: "session-1",
  sessionToken: "token-1",
  address: "0x1111111111111111111111111111111111111111",
  expiresAt: Date.now() + 60_000,
};

const walletContext: WalletContext = {
  address: session.address,
  chainId: 11155111,
  chainName: "Sepolia",
  nativeBalanceWei: "10000000000000000",
  nativeBalanceEth: "0.01",
  tokenBalances: [],
  nftAssets: [],
  swapAvailable: true,
  supportedSwapTokens: [
    {
      chainId: 11155111,
      symbol: "ETH",
      name: "Ether",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      isNative: true,
    },
  ],
  activePermission: null,
  recentActions: [],
};

const pendingAction: PendingWalletAction = {
  id: "action-1",
  type: "native_transfer",
  status: "ready",
  chainId: 11155111,
  toAddress: "0x2222222222222222222222222222222222222222",
  valueWei: "1000000000000000",
  valueEth: "0.001",
  estimatedValueUsd: "2.50",
  summary: "Send 0.001 ETH",
  reason: null,
  requiresPermission: false,
  canAutoExecute: true,
  txHash: null,
  error: null,
  permissionGrantId: "grant-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("API handler helpers", () => {
  test("creates an auth challenge with injected services", async () => {
    const result = await handleAuthChallengeRequest(
      { address: session.address },
      {
        sessionService: {
          createChallenge: (address: string) => ({
            address,
            nonce: "nonce-1",
            message: "challenge",
            expiresAt: Date.now() + 60_000,
          }),
        } as never,
      },
    );

    expect(result.address).toBe(session.address);
    expect(result.message).toBe("challenge");
  });

  test("returns wallet context when verifying a session and when loading context later", async () => {
    const verifyResult = await handleAuthVerifyRequest(
      {
        address: session.address,
        signature: "0xsigned",
      },
      {
        sessionService: {
          verifyChallenge: () => ({
            session,
            challenge: {
              address: session.address,
              nonce: "nonce-1",
              message: "challenge",
              expiresAt: Date.now() + 60_000,
            },
          }),
          getSession: () => session,
        } as never,
        walletService: {
          getWalletContext: async () => walletContext,
        } as never,
      },
    );

    expect(verifyResult.walletContext.swapAvailable).toBe(true);

    const contextResult = await handleWalletContextRequest(session.sessionToken, {
      sessionService: {
        getSession: () => session,
      } as never,
      walletService: {
        getWalletContext: async () => walletContext,
      } as never,
    });

    expect(contextResult.walletContext.address).toBe(session.address);
  });

  test("routes chat requests through the injected agent service", async () => {
    const response: ChatResponse = {
      message: "Your balance is 0.01 ETH.",
      walletContext,
      pendingAction: null,
    };

    const result = await handleChatRequest(
      session.sessionToken,
      { message: "What is my balance?" },
      {
        sessionService: {
          getSession: () => session,
        } as never,
        agentService: {
          runChat: async () => response,
        } as never,
      },
    );

    expect(result.message).toBe(response.message);
    expect(result.walletContext.nativeBalanceEth).toBe("0.01");
  });

  test("records a permission grant and confirms an action with injected wallet service", async () => {
    const result = await handlePermissionGrantRequest(
      session.sessionToken,
      {
        chainId: 11155111,
        actionType: "native_transfer",
        allowedAddresses: [pendingAction.toAddress],
        maxAmountUsd: "10",
        requestedExpirySeconds: 1800,
      },
      {
        sessionService: {
          getSession: () => session,
        } as never,
        walletService: {
          recordPermissionGrant: () => ({
            id: "grant-1",
            chainId: 11155111,
            actionType: "native_transfer",
            allowedAddresses: [pendingAction.toAddress],
            maxAmountUsd: "10",
            expiresAt: new Date(Date.now() + 1800_000).toISOString(),
            createdAt: new Date().toISOString(),
            status: "active",
          }),
          getWalletContext: async () => walletContext,
        } as never,
      },
    );

    expect(result.grant.id).toBe("grant-1");

    const confirmation = await handleConfirmActionRequest(session.sessionToken, pendingAction.id, {
      sessionService: {
        getSession: () => session,
      } as never,
      walletService: {
        confirmAction: () => pendingAction,
        getWalletContext: async () => walletContext,
      } as never,
    });

    expect(confirmation.action.id).toBe(pendingAction.id);
    expect(confirmation.action.canAutoExecute).toBe(true);
  });

  test("creates a draft action through the injected wallet service", async () => {
    const result = await handleActionDraftRequest(
      session.sessionToken,
      {
        type: "token_swap",
        tokenIn: "ETH",
        tokenOut: "USDC",
        amount: "0.01",
      },
      {
        sessionService: {
          getSession: () => session,
        } as never,
        walletService: {
          createPendingSwap: async () => pendingAction,
          getWalletContext: async () => walletContext,
        } as never,
      },
    );

    expect(result.action.id).toBe(pendingAction.id);
    expect(result.walletContext.supportedSwapTokens).toHaveLength(1);
  });
});
