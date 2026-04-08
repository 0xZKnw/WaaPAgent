import { fromChatMessages, stepCountIs, tool } from "@openrouter/agent";
import { z } from "zod";

import { env } from "@/lib/env";
import type {
  AgentToolTraceItem,
  ChatResponse,
  PendingWalletAction,
} from "@/lib/types";
import { toErrorMessage } from "@/lib/utils";
import { ExaMcpService } from "@/server/services/exa-mcp-service";
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
    .describe("Input token symbol or address on Sepolia. Use a supported token like ETH, WETH, or USDC."),
  tokenOut: z
    .string()
    .min(1)
    .describe("Output token symbol or address on Sepolia. Use a supported token like ETH, WETH, or USDC."),
  amount: z
    .string()
    .min(1)
    .describe("Exact input amount as a decimal string like 0.01."),
  reason: z.string().optional(),
});

const nftTransferSchema = z.object({
  contractAddress: z.string().describe("NFT contract address on Sepolia."),
  tokenId: z.string().min(1).describe("NFT token id as a string."),
  toAddress: z.string().describe("Recipient address on Sepolia."),
  quantity: z
    .string()
    .min(1)
    .optional()
    .describe("Optional quantity for ERC-1155 transfers. Omit for ERC-721."),
  reason: z.string().optional(),
});

const webSearchSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("Natural-language web query describing the ideal page to find."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many search results to retrieve."),
});

const webFetchSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(3)
    .describe("One to three URLs to fetch and read."),
  maxCharacters: z
    .number()
    .int()
    .min(500)
    .max(10000)
    .default(4000)
    .describe("Maximum characters to extract per page."),
});

function sanitizeAssistantText(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^[*-]\s+/gm, "")
    .trim();
}

function getToolEventId(toolName: string, context?: { toolCall?: { callId?: string; id?: string } }) {
  return context?.toolCall?.callId ?? context?.toolCall?.id ?? `${toolName}-${Date.now()}`;
}

function trimDetail(value: string, maxLength = 92) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatToolTraceMeta(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "get_wallet_context":
      return { label: "Wallet context", detail: "Reading portfolio, permissions, and recent activity." };
    case "get_native_balance":
      return { label: "Native balance", detail: "Checking Sepolia ETH balance." };
    case "get_token_balances":
      return { label: "Token balances", detail: "Inspecting ERC-20 balances." };
    case "list_supported_swap_tokens":
      return { label: "Swap universe", detail: "Listing supported swap pairs." };
    case "get_nft_inventory":
      return { label: "NFT inventory", detail: "Reading NFT collections and holdings." };
    case "prepare_native_transfer":
      return {
        label: "Transfer preview",
        detail:
          typeof input.amountEth === "string" && typeof input.toAddress === "string"
            ? trimDetail(`${input.amountEth} ETH to ${input.toAddress}`)
            : "Preparing a native transfer preview.",
      };
    case "prepare_token_swap":
      return {
        label: "Swap preview",
        detail:
          typeof input.amount === "string" &&
          typeof input.tokenIn === "string" &&
          typeof input.tokenOut === "string"
            ? trimDetail(`${input.amount} ${input.tokenIn} to ${input.tokenOut}`)
            : "Preparing a token swap preview.",
      };
    case "prepare_nft_transfer":
      return {
        label: "NFT preview",
        detail:
          typeof input.tokenId === "string" && typeof input.contractAddress === "string"
            ? trimDetail(`Token #${input.tokenId} from ${input.contractAddress}`)
            : "Preparing an NFT transfer preview.",
      };
    case "send_native_transfer":
      return {
        label: "Transfer action",
        detail:
          typeof input.amountEth === "string" && typeof input.toAddress === "string"
            ? trimDetail(`Creating ${input.amountEth} ETH send action.`)
            : "Creating a native transfer action.",
      };
    case "send_token_swap":
      return {
        label: "Swap action",
        detail:
          typeof input.amount === "string" &&
          typeof input.tokenIn === "string" &&
          typeof input.tokenOut === "string"
            ? trimDetail(`Routing ${input.amount} ${input.tokenIn} to ${input.tokenOut}.`)
            : "Creating a swap action.",
      };
    case "send_nft_transfer":
      return {
        label: "NFT action",
        detail:
          typeof input.tokenId === "string" && typeof input.toAddress === "string"
            ? trimDetail(`Preparing token #${input.tokenId} for ${input.toAddress}.`)
            : "Creating an NFT transfer action.",
      };
    case "list_recent_actions":
      return { label: "Recent actions", detail: "Loading the recent wallet timeline." };
    case "search_web":
      return {
        label: "Web search",
        detail:
          typeof input.query === "string" ? trimDetail(input.query) : "Searching the live web.",
      };
    case "fetch_web_page":
      return {
        label: "Page reader",
        detail: Array.isArray(input.urls)
          ? trimDetail(input.urls.join(" · "))
          : "Reading a webpage in full.",
      };
    default:
      return {
        label: name.replace(/_/g, " "),
        detail: null,
      };
  }
}

export class AgentService {
  constructor(
    private readonly walletService = new WaapWalletService(),
    private readonly exaService = new ExaMcpService(),
  ) {}

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
      sanitizeAssistantText((await result.getText()) || "") ||
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
    onToolTrace?: (event: AgentToolTraceItem) => void | Promise<void>,
  ): Promise<ChatResponse> {
    this.walletService.recordMessage(session.id, "user", message);

    const recentMessages = this.walletService.getRecentMessages(session.id, 8);
    const latestActionRef = { current: null as PendingWalletAction | null };
    const toolTrace: AgentToolTraceItem[] = [];
    const result = this.createModelResult(
      session,
      recentMessages,
      latestActionRef,
      async (event) => {
        const index = toolTrace.findIndex((item) => item.id === event.id);

        if (index >= 0) {
          toolTrace[index] = event;
        } else {
          toolTrace.push(event);
        }

        await onToolTrace?.(event);
      },
    );

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
      sanitizeAssistantText(streamedText) ||
      sanitizeAssistantText((await result.getText()) || "") ||
      latestActionRef.current?.summary ||
      "I checked your wallet state and I am ready for the next step.";

    const freshWalletContext = await this.walletService.getWalletContext(session);
    this.walletService.recordMessage(session.id, "assistant", responseText);

    return {
      message: responseText,
      walletContext: freshWalletContext,
      pendingAction: latestActionRef.current,
      toolTrace,
    };
  }

  private createModelResult(
    session: AppSession,
    recentMessages: Array<{ role: "user" | "assistant"; content: string }>,
    latestActionRef: { current: PendingWalletAction | null },
    onToolTrace?: (event: AgentToolTraceItem) => void | Promise<void>,
  ) {
    const client = createOpenRouterClient();

    if (!client) {
      return null;
    }

    const runWithToolTrace = async <TInput extends Record<string, unknown>, TResult>(
      toolName: string,
      input: TInput,
      context: { toolCall?: { callId?: string; id?: string } } | undefined,
      fn: () => Promise<TResult>,
    ) => {
      const id = getToolEventId(toolName, context);
      const meta = formatToolTraceMeta(toolName, input);

      await onToolTrace?.({
        id,
        name: toolName,
        label: meta.label,
        detail: meta.detail,
        status: "running",
      });

      try {
        const result = await fn();

        await onToolTrace?.({
          id,
          name: toolName,
          label: meta.label,
          detail: meta.detail,
          status: "completed",
        });

        return result;
      } catch (error) {
        await onToolTrace?.({
          id,
          name: toolName,
          label: meta.label,
          detail: trimDetail(
            error instanceof Error ? error.message : "Tool execution failed.",
          ),
          status: "failed",
        });
        throw error;
      }
    };

    const getWalletContextTool = tool({
      name: "get_wallet_context",
      description: "Get the connected wallet summary, active permission, and recent actions.",
      inputSchema: z.object({}),
      execute: async (input, context) => {
        return runWithToolTrace("get_wallet_context", input, context, async () =>
          this.walletService.getWalletContext(session),
        );
      },
    });

    const getNativeBalanceTool = tool({
      name: "get_native_balance",
      description: "Get the Sepolia ETH balance for the connected wallet.",
      inputSchema: z.object({}),
      execute: async (input, context) => {
        return runWithToolTrace("get_native_balance", input, context, async () => {
          const freshContext = await this.walletService.getWalletContext(session);
          return {
            address: freshContext.address,
            nativeBalanceWei: freshContext.nativeBalanceWei,
            nativeBalanceEth: freshContext.nativeBalanceEth,
          };
        });
      },
    });

    const getTokenBalancesTool = tool({
      name: "get_token_balances",
      description: "Get Sepolia ERC-20 token balances for the connected wallet.",
      inputSchema: z.object({}),
      execute: async (input, context) => {
        return runWithToolTrace("get_token_balances", input, context, async () => {
          const freshContext = await this.walletService.getWalletContext(session);
          return freshContext.tokenBalances;
        });
      },
    });

    const listSupportedSwapTokensTool = tool({
      name: "list_supported_swap_tokens",
      description: "List the tokens that can currently be swapped on Sepolia.",
      inputSchema: z.object({}),
      execute: async (input, context) => {
        return runWithToolTrace("list_supported_swap_tokens", input, context, async () => {
          const freshContext = await this.walletService.getWalletContext(session);
          return freshContext.supportedSwapTokens;
        });
      },
    });

    const getNftInventoryTool = tool({
      name: "get_nft_inventory",
      description: "Get the NFTs currently owned by the connected wallet on Sepolia.",
      inputSchema: z.object({}),
      execute: async (input, context) => {
        return runWithToolTrace("get_nft_inventory", input, context, async () =>
          this.walletService.getWalletNfts(session),
        );
      },
    });

    const prepareTransferTool = tool({
      name: "prepare_native_transfer",
      description:
        "Preview a native ETH transfer on Sepolia without creating an executable action.",
      inputSchema: transferSchema,
      execute: async (input, context) => {
        return runWithToolTrace("prepare_native_transfer", input, context, async () =>
          this.walletService.createTransferPreview(session, input),
        );
      },
    });

    const prepareSwapTool = tool({
      name: "prepare_token_swap",
      description:
        "Preview an exact-input token swap on Sepolia without creating an executable action. Swaps are limited to supported Sepolia tokens such as ETH, WETH, and USDC.",
      inputSchema: swapSchema,
      execute: async (input, context) => {
        return runWithToolTrace("prepare_token_swap", input, context, async () =>
          this.walletService.createSwapPreview(session, input),
        );
      },
    });

    const prepareNftTransferTool = tool({
      name: "prepare_nft_transfer",
      description:
        "Preview an NFT transfer on Sepolia without creating an executable action. NFT transfers are limited to owned assets on Sepolia.",
      inputSchema: nftTransferSchema,
      execute: async (input, context) => {
        return runWithToolTrace("prepare_nft_transfer", input, context, async () =>
          this.walletService.createNftTransferPreview(session, input),
        );
      },
    });

    const sendTransferTool = tool({
      name: "send_native_transfer",
      description:
        "Create a pending or ready-to-run transfer action. Use this only when the user clearly wants to send now.",
      inputSchema: transferSchema,
      execute: async (input, context) => {
        return runWithToolTrace("send_native_transfer", input, context, async () => {
          latestActionRef.current = await this.walletService.createPendingTransfer(session, input);

          return {
            actionId: latestActionRef.current?.id,
            status: latestActionRef.current?.status,
            requiresPermission: latestActionRef.current?.requiresPermission,
            canAutoExecute: latestActionRef.current?.canAutoExecute,
            summary: latestActionRef.current?.summary,
          };
        });
      },
    });

    const sendSwapTool = tool({
      name: "send_token_swap",
      description:
        "Create a pending or ready-to-run swap action. Use this only when the user clearly wants to swap now. Swaps are limited to the supported Sepolia token list.",
      inputSchema: swapSchema,
      execute: async (input, context) => {
        return runWithToolTrace("send_token_swap", input, context, async () => {
          latestActionRef.current = await this.walletService.createPendingSwap(session, input);

          return {
            actionId: latestActionRef.current?.id,
            status: latestActionRef.current?.status,
            requiresPermission: latestActionRef.current?.requiresPermission,
            canAutoExecute: latestActionRef.current?.canAutoExecute,
            summary: latestActionRef.current?.summary,
          };
        });
      },
    });

    const sendNftTransferTool = tool({
      name: "send_nft_transfer",
      description:
        "Create a pending or ready-to-run NFT transfer action. Use this only when the user clearly wants to send an owned NFT now. ERC-721 and ERC-1155 are supported when the asset is owned.",
      inputSchema: nftTransferSchema,
      execute: async (input, context) => {
        return runWithToolTrace("send_nft_transfer", input, context, async () => {
          latestActionRef.current = await this.walletService.createPendingNftTransfer(
            session,
            input,
          );

          return {
            actionId: latestActionRef.current?.id,
            status: latestActionRef.current?.status,
            requiresPermission: latestActionRef.current?.requiresPermission,
            canAutoExecute: latestActionRef.current?.canAutoExecute,
            summary: latestActionRef.current?.summary,
          };
        });
      },
    });

    const listRecentActionsTool = tool({
      name: "list_recent_actions",
      description: "List recent wallet actions and their statuses.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ limit }, context) => {
        return runWithToolTrace("list_recent_actions", { limit }, context, async () =>
          this.walletService.listRecentActions(session.id, limit),
        );
      },
    });

    const searchWebTool = tool({
      name: "search_web",
      description:
        "Search the live web for current information, external docs, news, or facts that are not already in wallet context.",
      inputSchema: webSearchSchema,
      execute: async ({ query, numResults }, context) => {
        return runWithToolTrace("search_web", { query, numResults }, context, async () =>
          this.exaService.searchWeb(query, numResults),
        );
      },
    });

    const fetchWebPageTool = tool({
      name: "fetch_web_page",
      description:
        "Read one to three known URLs after searching the web, when you need the full page content.",
      inputSchema: webFetchSchema,
      execute: async ({ urls, maxCharacters }, context) => {
        return runWithToolTrace(
          "fetch_web_page",
          { urls, maxCharacters },
          context,
          async () => this.exaService.fetchWebPages(urls, maxCharacters),
        );
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
            "You can read wallet context, inspect token balances and NFTs, and create transfer, swap, or NFT transfer actions.",
            "For live external information, documentation, or anything that may have changed, use the web tools before answering.",
            "Reply in the same language as the user unless they ask otherwise.",
            "When the user asks to send funds, swap tokens, or move an NFT, first be explicit about the amount, token pair, NFT identity, destination, and whether a permission grant is needed.",
            "Swaps are limited to the supported token list on Sepolia. Use the supported-token tool if needed.",
            "NFT transfers are limited to owned assets on Sepolia. ERC-721 and ERC-1155 can be moved.",
            "Do not mention hidden implementation details like internal database tables.",
            "Respond in plain text only.",
            "Do not use Markdown, bullet points, numbered lists, headings, tables, code fences, bold, italics, or inline code.",
            "Do not use emojis, decorative symbols, or roleplay style formatting.",
            "Keep replies natural, direct, and compact.",
            "Prefer one short paragraph, or at most two short paragraphs when needed.",
            "If you use the web, mention the source domain briefly in plain text.",
            "When the user asks what you can do, give at most three concrete examples, not a long feature list.",
            "When you prepare an action, say what is ready now and the single next step the user must take.",
            "When you answer from wallet data, give the answer first, then one useful next-step suggestion only if it helps.",
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
        listSupportedSwapTokensTool,
        getNftInventoryTool,
        prepareTransferTool,
        prepareSwapTool,
        prepareNftTransferTool,
        sendTransferTool,
        sendSwapTool,
        sendNftTransferTool,
        listRecentActionsTool,
        searchWebTool,
        fetchWebPageTool,
      ] as const,
      stopWhen: stepCountIs(8),
    });
  }

  private async runFallback(session: AppSession, message: string): Promise<ChatResponse> {
    const normalized = message.toLowerCase();
    let pendingAction: ChatResponse["pendingAction"] = null;
    let responseMessage =
      "OpenRouter is not configured yet, but the wallet stack is live. Ask for your balance, your tokens or NFTs, a simple ETH transfer, an NFT transfer, or a supported Sepolia swap.";

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

    if (normalized.includes("nft")) {
      const nftAssets = await this.walletService.getWalletNfts(session);
      responseMessage = nftAssets.length
        ? `Your wallet currently holds these NFTs on Sepolia: ${nftAssets
            .slice(0, 6)
            .map((item) => `${item.name} from ${item.collectionName}`)
            .join(", ")}.`
        : "Your wallet has no NFT assets detected on Sepolia.";
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
      /(swap)\s+([0-9]*\.?[0-9]+)\s+(eth|weth|usdc)\s+(to|for)\s+(eth|weth|usdc)/i,
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

    const nftTransferMatch = normalized.match(
      /(send|transfer)\s+(?:nft\s+)?(?:token\s+id\s+)?([0-9]+)\s+from\s+(0x[a-f0-9]{40})\s+to\s+(0x[a-f0-9]{40})/i,
    );

    if (nftTransferMatch) {
      try {
        pendingAction = await this.walletService.createPendingNftTransfer(session, {
          tokenId: nftTransferMatch[2],
          contractAddress: nftTransferMatch[3],
          toAddress: nftTransferMatch[4],
          quantity: "1",
        });

        if (!pendingAction) {
          throw new Error("The NFT transfer action could not be created.");
        }

        responseMessage = pendingAction.canAutoExecute
          ? `I prepared the NFT transfer and it is ready to execute: ${pendingAction.summary}`
          : `I prepared the NFT transfer. Grant a WaaP permission token to continue: ${pendingAction.summary}`;
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
