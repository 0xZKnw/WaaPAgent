import { z } from "zod";

import { SEPOLIA_CHAIN_ID } from "@/lib/constants";
import type { ChatRequest, PermissionGrantInput, WalletContext } from "@/lib/types";
import { AgentService } from "@/server/services/agent-service";
import { SessionService, type AppSession } from "@/server/services/session-service";
import { WaapWalletService } from "@/server/services/waap-wallet-service";

const addressSchema = z.object({
  address: z.string().min(1),
});

const verifySchema = z.object({
  address: z.string().min(1),
  signature: z.string().min(1),
});

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

const permissionSchema = z.object({
  actionId: z.string().optional(),
  chainId: z.number().int().default(SEPOLIA_CHAIN_ID),
  actionType: z.union([
    z.literal("native_transfer"),
    z.literal("token_swap"),
    z.literal("nft_transfer"),
  ]),
  allowedAddresses: z.array(z.string()).min(1),
  maxAmountUsd: z.string().min(1),
  requestedExpirySeconds: z.number().int().min(60).max(7200),
});

const actionDraftSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("native_transfer"),
    toAddress: z.string().min(1),
    amountEth: z.string().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("token_swap"),
    tokenIn: z.string().min(1),
    tokenOut: z.string().min(1),
    amount: z.string().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("nft_transfer"),
    contractAddress: z.string().min(1),
    tokenId: z.string().min(1),
    toAddress: z.string().min(1),
    quantity: z.string().min(1).optional(),
    reason: z.string().optional(),
  }),
]);

const actionCompletionSchema = z.object({
  status: z.union([z.literal("completed"), z.literal("failed")]),
  txHash: z.string().optional(),
  error: z.string().optional(),
});

interface Dependencies {
  sessionService: SessionService;
  walletService: WaapWalletService;
  agentService: AgentService;
}

interface ResolvedChatRequest {
  deps: Dependencies;
  session: NonNullable<Awaited<ReturnType<SessionService["getSession"]>>>;
  message: string;
}

function getDependencies(overrides?: Partial<Dependencies>): Dependencies {
  const walletService = overrides?.walletService ?? new WaapWalletService();

  return {
    sessionService: overrides?.sessionService ?? new SessionService(),
    walletService,
    agentService: overrides?.agentService ?? new AgentService(walletService),
  };
}

export function resolveChatRequest(
  sessionToken: string | undefined,
  body: ChatRequest | unknown,
  overrides?: Partial<Dependencies>,
): ResolvedChatRequest {
  if (!sessionToken) {
    throw new Error("You must connect a wallet first.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const parsed = chatSchema.parse(body);

  return {
    deps,
    session,
    message: parsed.message,
  };
}

export async function handleAuthChallengeRequest(
  body: unknown,
  overrides?: Partial<Dependencies>,
) {
  const deps = getDependencies(overrides);
  const parsed = addressSchema.parse(body);
  return deps.sessionService.createChallenge(parsed.address);
}

export async function handleAuthVerifyRequest(
  body: unknown,
  overrides?: Partial<Dependencies>,
): Promise<{
  session: AppSession;
  challengeMessage: string;
  walletContext: WalletContext;
}> {
  const deps = getDependencies(overrides);
  const parsed = verifySchema.parse(body);
  const result = await deps.sessionService.verifyChallenge(
    parsed.address,
    parsed.signature,
  );
  const walletContext = await deps.walletService.getWalletContext(result.session);
  return {
    ...result,
    walletContext,
  };
}

export async function handleWalletContextRequest(
  sessionToken: string | undefined,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const walletContext = await deps.walletService.getWalletContext(session);

  return {
    walletContext,
  };
}

export async function handleWalletNftsRequest(
  sessionToken: string | undefined,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const nftAssets = await deps.walletService.getWalletNfts(session);

  return {
    nftAssets,
  };
}

export async function handleChatRequest(
  sessionToken: string | undefined,
  body: ChatRequest | unknown,
  overrides?: Partial<Dependencies>,
) {
  const resolved = resolveChatRequest(sessionToken, body, overrides);
  return resolved.deps.agentService.runChat(resolved.session, resolved.message);
}

export async function handlePermissionGrantRequest(
  sessionToken: string | undefined,
  body: PermissionGrantInput | unknown,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const parsed = permissionSchema.parse(body);
  const grant = deps.walletService.recordPermissionGrant(session.id, parsed);
  const walletContext = await deps.walletService.getWalletContext(session);

  return { grant, walletContext };
}

export async function handleActionDraftRequest(
  sessionToken: string | undefined,
  body: unknown,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const parsed = actionDraftSchema.parse(body);

  const action =
    parsed.type === "native_transfer"
      ? await deps.walletService.createPendingTransfer(session, parsed)
      : parsed.type === "token_swap"
        ? await deps.walletService.createPendingSwap(session, parsed)
        : await deps.walletService.createPendingNftTransfer(session, parsed);

  const walletContext = await deps.walletService.getWalletContext(session);

  return { action, walletContext };
}

export async function handleConfirmActionRequest(
  sessionToken: string | undefined,
  actionId: string,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const action = deps.walletService.confirmAction(session.id, actionId);
  const walletContext = await deps.walletService.getWalletContext(session);

  return { action, walletContext };
}

export async function handleCompleteActionRequest(
  sessionToken: string | undefined,
  actionId: string,
  body: unknown,
  overrides?: Partial<Dependencies>,
) {
  if (!sessionToken) {
    throw new Error("Missing session.");
  }

  const deps = getDependencies(overrides);
  const session = deps.sessionService.getSession(sessionToken);

  if (!session) {
    throw new Error("Session expired. Please reconnect your wallet.");
  }

  const parsed = actionCompletionSchema.parse(body);
  const action = deps.walletService.completeAction(session.id, actionId, parsed);
  const walletContext = await deps.walletService.getWalletContext(session);

  return { action, walletContext };
}
