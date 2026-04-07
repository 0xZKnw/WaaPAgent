import { fromChatMessages, stepCountIs, tool } from "@openrouter/agent";
import { z } from "zod";

import { env } from "@/lib/env";
import type { ChatResponse, PendingWalletAction } from "@/lib/types";
import { toErrorMessage } from "@/lib/utils";
import { createOpenRouterClient } from "@/server/services/openrouter-service";
import type { AppSession } from "@/server/services/session-service";
import { WaapWalletService } from "@/server/services/waap-wallet-service";

const transferSchema = z.object({
  toAddress: z.string().describe("Recipient address on Sepolia."),
  amountEth: z
    .string()
    .min(1)
    .describe("Amount of ETH to send on Sepolia, as a decimal string like 0.01."),
  reason: z.string().optional(),
});

const swapSchema = z.object({
  tokenIn: z
    .string()
    .min(1)
    .describe("Input token symbol or address on Sepolia. For now, use ETH or USDC."),
  tokenOut: z
    .string()
    .min(1)
    .describe("Output token symbol or address on Sepolia. For now, use ETH or USDC."),
  amount: z
    .string()
    .min(1)
    .describe("Exact input amount as a decimal string like 0.01."),
  reason: z.string().optional(),
});

export class AgentService {
  constructor(private readonly walletService = new WaapWalletService()) {}

  async runChat(session: AppSession, message: string): Promise<ChatResponse> {
    this.walletService.recordMessage(session.id, "user", message);

    const recentMessages = this.walletService.getRecentMessages(session.id, 8);
    const latestActionRef = { current: null as PendingWalletAction | null };
    const result = this.createModelResult(session, recentMessages, latestActionRef);

    if (!result) {
      const fallback = await this.runFallback(session, message);
      this.walletService.recordMessage(session.id, "assistant", fallback.message);
      return fallback;
    }
    const actionSummary = latestActionRef.current?.summary;
    const responseText =
      (await result.getText()) ||
      actionSummary ||
      "I checked your wallet state and I am ready for the next step.";

    const freshWalletContext = await this.walletService.getWalletContext(session);
    this.walletService.recordMessage(session.id, "assistant", responseText);

    return {
      message: responseText,
      walletContext: freshWalletContext,
      pendingAction: latestActionRef.current,
    };
  }

  async runChatStream(
    session: AppSession,
    message: string,
    onTextDelta: (delta: string) => void | Promise<void>,
  ): Promise<ChatResponse> {
    this.walletService.recordMessage(session.id, "user", message);

    const recentMessages = this.walletService.getRecentMessages(session.id, 8);
    const latestActionRef = { current: null as PendingWalletAction | null };
    const result = this.createModelResult(session, recentMessages, latestActionRef);

    if (!result) {
      const fallback = await this.runFallback(session, message);
      if (fallback.message) {
        await onTextDelta(fallback.message);
      }
      this.walletService.recordMessage(session.id, "assistant", fallback.message);
      return fallback;
    }

    let streamedText = "";

    for await (const delta of result.getTextStream()) {
      streamedText += delta;
      await onTextDelta(delta);
    }

    const responseText =
      streamedText ||
      (await result.getText()) ||
      latestActionRef.current?.summary ||
      "I checked your wallet state and I am ready for the next step.";

    const freshWalletContext = await this.walletService.getWalletContext(session);
    this.walletService.recordMessage(session.id, "assistant", responseText);

    return {
      message: responseText,
      walletContext: freshWalletContext,
      pendingAction: latestActionRef.current,
    };
  }

  private createModelResult(
    session: AppSession,
    recentMessages: Array<{ role: "user" | "assistant"; content: string }>,
    latestActionRef: { current: PendingWalletAction | null },
  ) {
    const client = createOpenRouterClient();

    if (!client) {
      return null;
    }

    const getWalletContextTool = tool({
      name: "get_wallet_context",
      description: "Get the connected wallet summary, active permission, and recent actions.",
      inputSchema: z.object({}),
      execute: async () => {
        return await this.walletService.getWalletContext(session);
      },
    });

    const getNativeBalanceTool = tool({
      name: "get_native_balance",
      description: "Get the Sepolia ETH balance for the connected wallet.",
      inputSchema: z.object({}),
      execute: async () => {
        const freshContext = await this.walletService.getWalletContext(session);
        return {
          address: freshContext.address,
          nativeBalanceWei: freshContext.nativeBalanceWei,
          nativeBalanceEth: freshContext.nativeBalanceEth,
        };
      },
    });

    const getTokenBalancesTool = tool({
      name: "get_token_balances",
      description: "Get Sepolia ERC-20 token balances for the connected wallet.",
      inputSchema: z.object({}),
      execute: async () => {
        const freshContext = await this.walletService.getWalletContext(session);
        return freshContext.tokenBalances;
      },
    });

    const prepareTransferTool = tool({
      name: "prepare_native_transfer",
      description:
        "Preview a native ETH transfer on Sepolia without creating an executable action.",
      inputSchema: transferSchema,
      execute: async (input) => {
        return this.walletService.createTransferPreview(session, input);
      },
    });

    const prepareSwapTool = tool({
      name: "prepare_token_swap",
      description:
        "Preview an exact-input token swap on Sepolia without creating an executable action. Swaps are limited to ETH and USDC.",
      inputSchema: swapSchema,
      execute: async (input) => {
        return this.walletService.createSwapPreview(session, input);
      },
    });

    const sendTransferTool = tool({
      name: "send_native_transfer",
      description:
        "Create a pending or ready-to-run transfer action. Use this only when the user clearly wants to send now.",
      inputSchema: transferSchema,
      execute: async (input) => {
        latestActionRef.current = await this.walletService.createPendingTransfer(session, input);

        return {
          actionId: latestActionRef.current?.id,
          status: latestActionRef.current?.status,
          requiresPermission: latestActionRef.current?.requiresPermission,
          canAutoExecute: latestActionRef.current?.canAutoExecute,
          summary: latestActionRef.current?.summary,
        };
      },
    });

    const sendSwapTool = tool({
      name: "send_token_swap",
      description:
        "Create a pending or ready-to-run swap action. Use this only when the user clearly wants to swap now. Swaps are limited to ETH and USDC on Sepolia.",
      inputSchema: swapSchema,
      execute: async (input) => {
        latestActionRef.current = await this.walletService.createPendingSwap(session, input);

        return {
          actionId: latestActionRef.current?.id,
          status: latestActionRef.current?.status,
          requiresPermission: latestActionRef.current?.requiresPermission,
          canAutoExecute: latestActionRef.current?.canAutoExecute,
          summary: latestActionRef.current?.summary,
        };
      },
    });

    const listRecentActionsTool = tool({
      name: "list_recent_actions",
      description: "List recent wallet actions and their statuses.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ limit }) => {
        return this.walletService.listRecentActions(session.id, limit);
      },
    });

    return client.callModel({
      model: env.OPENROUTER_MODEL,
      input: fromChatMessages([
        {
          role: "system",
          content: [
            "You are a wallet-native AI agent inside a Next.js app.",
            "Operate only on Sepolia.",
            "Never invent wallet state; use tools.",
            "You can read wallet context, inspect token balances, and create transfer or swap actions.",
            "When the user asks to send funds or swap tokens, first be explicit about the amount, token pair or destination, and whether a permission grant is needed.",
            "Swaps are limited to ETH and USDC on Sepolia.",
            "Do not mention hidden implementation details like internal database tables.",
            "Respond in plain text only.",
            "Do not use Markdown, bullet points, numbered lists, headings, tables, code fences, bold, italics, or inline code.",
            "Do not use emojis, decorative symbols, or roleplay style formatting.",
            "Keep replies natural, direct, and compact.",
            "Prefer one short paragraph, or at most two short paragraphs when needed.",
            "Do not introduce yourself with a feature list unless the user explicitly asks what you can do.",
            "Do not mention tool names unless the user explicitly asks how the system works.",
          ].join(" "),
        },
        ...recentMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
      ]),
      tools: [
        getWalletContextTool,
        getNativeBalanceTool,
        getTokenBalancesTool,
        prepareTransferTool,
        prepareSwapTool,
        sendTransferTool,
        sendSwapTool,
        listRecentActionsTool,
      ] as const,
      stopWhen: stepCountIs(6),
    });
  }

  private async runFallback(session: AppSession, message: string): Promise<ChatResponse> {
    const normalized = message.toLowerCase();
    let pendingAction: ChatResponse["pendingAction"] = null;
    let responseMessage =
      "OpenRouter is not configured yet, but the wallet stack is live. Ask for your balance, a simple ETH transfer, or an ETH to USDC swap on Sepolia.";

    if (normalized.includes("balance")) {
      const context = await this.walletService.getWalletContext(session);
      responseMessage = `Your Sepolia wallet ${context.address} currently holds ${context.nativeBalanceEth} ETH.`;
      return {
        message: responseMessage,
        walletContext: context,
        pendingAction: null,
      };
    }

    if (normalized.includes("token")) {
      const context = await this.walletService.getWalletContext(session);
      responseMessage = context.tokenBalances.length
        ? `Your wallet holds these Sepolia ERC-20 balances: ${context.tokenBalances
            .map((token) => `${token.balanceDisplay} ${token.symbol}`)
            .join(", ")}.`
        : "Your wallet has no ERC-20 token balances detected on Sepolia.";
    }

    const transferMatch = normalized.match(
      /(send|transfer)\s+([0-9]*\.?[0-9]+)\s+eth\s+to\s+(0x[a-f0-9]{40})/i,
    );

    if (transferMatch) {
      try {
        pendingAction = await this.walletService.createPendingTransfer(session, {
          amountEth: transferMatch[2],
          toAddress: transferMatch[3],
        });

        if (!pendingAction) {
          throw new Error("The transfer action could not be created.");
        }

        responseMessage = pendingAction.canAutoExecute
          ? `I prepared the transfer and it is ready to execute: ${pendingAction.summary}`
          : `I prepared the transfer. Grant a WaaP permission token to continue: ${pendingAction.summary}`;
      } catch (error) {
        responseMessage = toErrorMessage(error);
      }
    }

    const swapMatch = normalized.match(
      /(swap)\s+([0-9]*\.?[0-9]+)\s+(eth|usdc)\s+(to|for)\s+(eth|usdc)/i,
    );

    if (swapMatch) {
      try {
        pendingAction = await this.walletService.createPendingSwap(session, {
          amount: swapMatch[2],
          tokenIn: swapMatch[3].toUpperCase(),
          tokenOut: swapMatch[5].toUpperCase(),
        });

        if (!pendingAction) {
          throw new Error("The swap action could not be created.");
        }

        responseMessage = pendingAction.canAutoExecute
          ? `I prepared the swap and it is ready to execute: ${pendingAction.summary}`
          : `I prepared the swap. Grant a WaaP permission token to continue: ${pendingAction.summary}`;
      } catch (error) {
        responseMessage = toErrorMessage(error);
      }
    }

    return {
      message: responseMessage,
      walletContext: await this.walletService.getWalletContext(session),
      pendingAction,
    };
  }
}
