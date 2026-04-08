"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { createPublicClient, formatEther, http, toHex } from "viem";
import { sepolia } from "viem/chains";
import { useEffect, useState } from "react";

import { ApprovalPanel } from "@/components/approval-panel";
import { ChatPanel } from "@/components/chat-panel";
import { useTheme } from "@/components/providers";
import { WalletPanel } from "@/components/wallet-panel";
import { SEPOLIA_CHAIN_ID } from "@/lib/constants";
import {
  ensureWaap,
  getWaapAccounts,
  isWaapManagedLoginMethod,
  requestWaapAccounts,
  switchToSepolia,
} from "@/lib/browser/waap";
import { publicEnv } from "@/lib/env";
import type {
  AgentToolTraceItem,
  ChatMessage,
  ChatResponse,
  PendingWalletAction,
  PreparedOnchainTransaction,
  WalletContext,
  WalletNftAsset,
} from "@/lib/types";
import { minutesToSeconds, nowIso, toErrorMessage } from "@/lib/utils";

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(publicEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL),
});

const WALLET_CONTEXT_REFRESH_MS = 10_000;
const NFT_REFRESH_MS = 60_000;

type DisplayChatMessage = ChatMessage & {
  toolTrace?: AgentToolTraceItem[];
};

type ActionDraftPayload =
  | {
      type: "native_transfer";
      toAddress: string;
      amountEth: string;
      reason?: string;
    }
  | {
      type: "token_swap";
      tokenIn: string;
      tokenOut: string;
      amount: string;
      reason?: string;
    }
  | {
      type: "nft_transfer";
      contractAddress: string;
      tokenId: string;
      toAddress: string;
      quantity?: string;
      reason?: string;
    };

async function postJson<T>(url: string, payload?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function getJson<T>(url: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const data = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function postChat<T>(
  payload: unknown,
  handlers: {
    onDelta: (delta: string) => void;
    onTool: (event: AgentToolTraceItem) => void;
  },
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-chat-stream": "true",
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "Request failed.");
  }

  if (!contentType.includes("application/x-ndjson")) {
    return (await response.json()) as T;
  }

  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Streaming response body is missing.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: T | null = null;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const chunk = JSON.parse(line) as
        | { type: "delta"; delta: string }
        | { type: "tool"; event: AgentToolTraceItem }
        | { type: "final"; response: T }
        | { type: "error"; error: string };

      if (chunk.type === "delta") {
        handlers.onDelta(chunk.delta);
      } else if (chunk.type === "tool") {
        handlers.onTool(chunk.event);
      } else if (chunk.type === "final") {
        finalResponse = chunk.response;
      } else if (chunk.type === "error") {
        throw new Error(chunk.error);
      }
    }
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer) as
      | { type: "tool"; event: AgentToolTraceItem }
      | { type: "final"; response: T }
      | { type: "error"; error: string };

    if (chunk.type === "tool") {
      handlers.onTool(chunk.event);
    } else if (chunk.type === "final") {
      finalResponse = chunk.response;
    } else {
      throw new Error(chunk.error);
    }
  }

  if (!finalResponse) {
    throw new Error("The streamed response ended before the final payload arrived.");
  }

  return finalResponse;
}

function toHexQuantity(value?: string | number) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.startsWith("0x")) {
    return value;
  }

  return toHex(BigInt(value));
}

function toRpcTransaction(
  tx: PreparedOnchainTransaction,
  fromAddress?: string,
  withValueOverride?: string,
) {
  return {
    from: tx.from ?? fromAddress,
    to: tx.to,
    data: tx.data,
    value: toHexQuantity(withValueOverride ?? tx.value ?? "0"),
    gas: toHexQuantity(tx.gasLimit),
    gasPrice: toHexQuantity(tx.gasPrice),
    maxFeePerGas: toHexQuantity(tx.maxFeePerGas),
    maxPriorityFeePerGas: toHexQuantity(tx.maxPriorityFeePerGas),
  };
}

function getNftKey(asset: Pick<WalletNftAsset, "contractAddress" | "tokenId">) {
  return `${asset.contractAddress}:${asset.tokenId}`;
}

function buildSuggestedPrompts(walletContext: WalletContext | null) {
  const suggestions = ["Show my wallet overview", "What tokens do I hold?"];

  if (walletContext?.nftAssets.length) {
    suggestions.push("Show my NFTs");
  }

  if (walletContext?.swapAvailable) {
    suggestions.push("Swap 0.01 ETH to USDC");
  }

  if (walletContext?.recentActions.length) {
    suggestions.push("What happened in my recent actions?");
  }

  return suggestions.slice(0, 4);
}

function mergeWalletContext(base: WalletContext | null, nftAssets: WalletNftAsset[] | null) {
  if (!base) {
    return null;
  }

  return {
    ...base,
    nftAssets: nftAssets ?? base.nftAssets,
  };
}

function upsertToolTrace(current: AgentToolTraceItem[], nextEvent: AgentToolTraceItem) {
  const index = current.findIndex((item) => item.id === nextEvent.id);

  if (index === -1) {
    return [...current, nextEvent];
  }

  const next = [...current];
  next[index] = nextEvent;
  return next;
}

export function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletContext, setWalletContext] = useState<WalletContext | null>(null);
  const [nftAssets, setNftAssets] = useState<WalletNftAsset[] | null>(null);
  const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
  const [activeAction, setActiveAction] = useState<PendingWalletAction | null>(null);
  const [selectedNftKey, setSelectedNftKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState("");
  const [streamingAssistantActive, setStreamingAssistantActive] = useState(false);
  const [streamingToolTrace, setStreamingToolTrace] = useState<AgentToolTraceItem[]>([]);
  const [themeReady, setThemeReady] = useState(false);

  const mergedWalletContext = mergeWalletContext(walletContext, nftAssets);
  const selectedNft =
    mergedWalletContext?.nftAssets.find((asset) => getNftKey(asset) === selectedNftKey) ?? null;
  const suggestionPrompts = buildSuggestedPrompts(mergedWalletContext);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const waap = await ensureWaap();

      setConnectError(null);

      const existingLoginMethod = waap.getLoginMethod();

      if (existingLoginMethod && !isWaapManagedLoginMethod(existingLoginMethod)) {
        await waap.logout();
      }

      const accounts = await requestWaapAccounts(waap, {
        interactive: true,
        preferWaapLogin: true,
      });

      const address = accounts[0];

      if (!address) {
        throw new Error(
          "Human Wallet did not return an address. The sign-in window may have been closed too early. Try again.",
        );
      }

      try {
        await switchToSepolia(waap);
      } catch (error) {
        console.warn("Sepolia switch failed after connect", error);
      }

      const challenge = await postJson<{ message: string }>("/api/auth/challenge", {
        address,
      });

      const signature = (await waap.request({
        method: "personal_sign",
        params: [challenge.message, address],
      })) as string;

      const verifyResponse = await postJson<{ walletContext?: WalletContext; address: string }>(
        "/api/auth/verify",
        {
          address,
          signature,
        },
      );

      return {
        address,
        walletContext: verifyResponse.walletContext ?? null,
      };
    },
    onSuccess: ({ address, walletContext: nextWalletContext }) => {
      setWalletAddress(address);
      setConnected(true);
      setConnectError(null);
      setWalletContext(nextWalletContext);
      setNftAssets(null);
    },
    onError: (error) => {
      setConnected(false);
      setConnectError(toErrorMessage(error));
    },
  });

  const balanceQuery = useQuery({
    queryKey: ["native-balance", walletAddress],
    enabled: Boolean(walletAddress),
    queryFn: async () => {
      const balance = await publicClient.getBalance({
        address: walletAddress as `0x${string}`,
      });
      return formatEther(balance);
    },
    refetchInterval: connected ? WALLET_CONTEXT_REFRESH_MS : false,
    refetchIntervalInBackground: true,
  });

  const walletContextQuery = useQuery({
    queryKey: ["wallet-context", walletAddress],
    enabled: connected && Boolean(walletAddress),
    queryFn: async () => {
      return getJson<{ walletContext: WalletContext }>("/api/wallet/context");
    },
    refetchInterval: WALLET_CONTEXT_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const walletNftsQuery = useQuery({
    queryKey: ["wallet-nfts", walletAddress],
    enabled: connected && Boolean(walletAddress),
    queryFn: async () => {
      return getJson<{ nftAssets: WalletNftAsset[] }>("/api/wallet/nfts");
    },
    refetchInterval: NFT_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) =>
      postChat<ChatResponse>(
        {
          message,
        },
        {
          onDelta: (delta) => {
            setStreamingAssistantActive(true);
            setStreamingAssistantMessage((current) => current + delta);
          },
          onTool: (event) => {
            setStreamingAssistantActive(true);
            setStreamingToolTrace((current) => upsertToolTrace(current, event));
          },
        },
      ),
    onMutate: async (message) => {
      setStreamingAssistantActive(true);
      setStreamingAssistantMessage("");
      setStreamingToolTrace([]);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: message,
          createdAt: nowIso(),
        },
      ]);
    },
    onSuccess: (response) => {
      setStreamingAssistantActive(false);
      setStreamingAssistantMessage("");
      const finalizedToolTrace =
        response.toolTrace && response.toolTrace.length > 0
          ? response.toolTrace
          : streamingToolTrace;
      setStreamingToolTrace([]);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.message,
          createdAt: nowIso(),
          toolTrace: finalizedToolTrace,
        },
      ]);
      setWalletContext(response.walletContext);
      if (response.walletContext.nftAssets.length) {
        setNftAssets(response.walletContext.nftAssets);
      }
      setActiveAction(response.pendingAction);
    },
    onError: (error) => {
      setStreamingAssistantActive(false);
      setStreamingAssistantMessage("");
      setStreamingToolTrace([]);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: toErrorMessage(error),
          createdAt: nowIso(),
        },
      ]);
    },
  });

  const draftActionMutation = useMutation({
    mutationFn: async (payload: ActionDraftPayload) =>
      postJson<{ action: PendingWalletAction; walletContext: WalletContext }>(
        "/api/actions/draft",
        payload,
      ),
    onSuccess: (response) => {
      setActiveAction(response.action);
      setWalletContext(response.walletContext);
    },
  });

  const confirmActionMutation = useMutation({
    mutationFn: async (actionId: string) =>
      postJson<{ action: PendingWalletAction; walletContext: WalletContext }>(
        `/api/actions/${actionId}/confirm`,
      ),
    onSuccess: (response) => {
      setActiveAction(response.action);
      setWalletContext(response.walletContext);
    },
  });

  const completeActionMutation = useMutation({
    mutationFn: async ({
      actionId,
      payload,
    }: {
      actionId: string;
      payload: { status: "completed" | "failed"; txHash?: string; error?: string };
    }) =>
      postJson<{ action: PendingWalletAction; walletContext: WalletContext }>(
        `/api/actions/${actionId}/complete`,
        payload,
      ),
    onSuccess: (response) => {
      setActiveAction(response.action);
      setWalletContext(response.walletContext);
      void balanceQuery.refetch();
      void walletContextQuery.refetch();
      void walletNftsQuery.refetch();
    },
  });

  const grantPermissionMutation = useMutation({
    mutationFn: async ({
      action,
      usdCap,
      expiryMinutes,
    }: {
      action: PendingWalletAction;
      usdCap: string;
      expiryMinutes: number;
    }) => {
      const waap = await ensureWaap();

      const result = (await waap.requestPermissionToken({
        chainId: SEPOLIA_CHAIN_ID,
        allowedAddresses: [action.toAddress],
        requestedAmountUsd: usdCap,
        requestedExpirySeconds: minutesToSeconds(expiryMinutes),
      })) as { success?: boolean; error?: string } | undefined;

      if (result?.success === false) {
        throw new Error(result.error || "Permission token request was rejected.");
      }

      return postJson<{ walletContext: WalletContext }>("/api/permissions/grant", {
        actionId: action.id,
        chainId: SEPOLIA_CHAIN_ID,
        actionType: action.type,
        allowedAddresses: [action.toAddress],
        maxAmountUsd: usdCap,
        requestedExpirySeconds: minutesToSeconds(expiryMinutes),
      });
    },
    onSuccess: (response) => {
      setWalletContext(response.walletContext);
      void walletNftsQuery.refetch();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const waap = await ensureWaap();
      await waap.logout();
      await postJson("/api/auth/logout");
    },
    onSuccess: () => {
      setWalletAddress(null);
      setWalletContext(null);
      setNftAssets(null);
      setActiveAction(null);
      setSelectedNftKey(null);
      setConnected(false);
      setConnectError(null);
      setMessages([]);
    },
    onError: (error) => {
      setConnectError(toErrorMessage(error));
    },
  });

  const combinedBusy =
    restoringSession ||
    connectMutation.isPending ||
    disconnectMutation.isPending ||
    chatMutation.isPending ||
    draftActionMutation.isPending ||
    grantPermissionMutation.isPending ||
    confirmActionMutation.isPending ||
    completeActionMutation.isPending;

  const resolvedTheme = themeReady ? theme : "light";

  useEffect(() => {
    setThemeReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const waap = await ensureWaap();
        const loginMethod = waap.getLoginMethod();

        if (!loginMethod) {
          return;
        }

        if (!isWaapManagedLoginMethod(loginMethod)) {
          await waap.logout();
          return;
        }

        const accounts = await getWaapAccounts(waap);
        const address = accounts[0];

        if (!address || cancelled) {
          return;
        }

        const contextResponse = await getJson<{ walletContext: WalletContext }>(
          "/api/wallet/context",
        ).catch(() => null);

        if (cancelled) {
          return;
        }

        setWalletAddress(address);
        setConnected(true);
        setConnectError(null);
        setWalletContext(contextResponse?.walletContext ?? null);
        setNftAssets(null);

        try {
          await switchToSepolia(waap);
        } catch (error) {
          console.warn("Sepolia switch failed during restore", error);
        }
      } catch (error) {
        if (!cancelled) {
          setConnectError(toErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setRestoringSession(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!walletContextQuery.data?.walletContext) {
      return;
    }

    setWalletContext(walletContextQuery.data.walletContext);

    if (!activeAction) {
      return;
    }

    const refreshedAction =
      walletContextQuery.data.walletContext.recentActions.find(
        (action) => action.id === activeAction.id,
      ) ?? null;

    if (refreshedAction) {
      setActiveAction(refreshedAction);
    }
  }, [activeAction, walletContextQuery.data]);

  useEffect(() => {
    if (!walletNftsQuery.data?.nftAssets) {
      return;
    }

    setNftAssets(walletNftsQuery.data.nftAssets);
  }, [walletNftsQuery.data]);

  useEffect(() => {
    if (!mergedWalletContext?.nftAssets.length) {
      setSelectedNftKey(null);
      return;
    }

    const hasSelection = mergedWalletContext.nftAssets.some(
      (asset) => getNftKey(asset) === selectedNftKey,
    );

    if (!selectedNftKey || !hasSelection) {
      setSelectedNftKey(getNftKey(mergedWalletContext.nftAssets[0]));
    }
  }, [mergedWalletContext?.nftAssets, selectedNftKey]);

  async function executeAction(action: PendingWalletAction) {
    if (!walletAddress) {
      throw new Error("Connect a wallet before executing an action.");
    }

    const waap = await ensureWaap();
    const confirmation = await confirmActionMutation.mutateAsync(action.id);

    if (!confirmation.action?.canAutoExecute) {
      throw new Error("Action is not ready to execute yet.");
    }

    try {
      let txHash: string;

      if (confirmation.action.type === "token_swap") {
        const metadata = confirmation.action.metadata;

        if (!metadata || metadata.kind !== "token_swap") {
          throw new Error("Swap action metadata is missing.");
        }

        if (metadata.approvalTx) {
          const approvalHash = (await waap.request({
            method: "eth_sendTransaction",
            params: [toRpcTransaction(metadata.approvalTx, walletAddress)],
          })) as string;

          await publicClient.waitForTransactionReceipt({
            hash: approvalHash as `0x${string}`,
          });
        }

        txHash = (await waap.request({
          method: "eth_sendTransaction",
          withPT: true,
          params: [toRpcTransaction(metadata.swapTx, walletAddress, confirmation.action.valueWei)],
        })) as string;
      } else if (
        confirmation.action.type === "nft_transfer" &&
        confirmation.action.metadata?.kind === "nft_transfer"
      ) {
        txHash = (await waap.request({
          method: "eth_sendTransaction",
          withPT: true,
          params: [toRpcTransaction(confirmation.action.metadata.transferTx, walletAddress)],
        })) as string;
      } else {
        txHash = (await waap.request({
          method: "eth_sendTransaction",
          withPT: true,
          params: [
            {
              from: walletAddress,
              to: confirmation.action.toAddress,
              value: toHex(BigInt(confirmation.action.valueWei)),
            },
          ],
        })) as string;
      }

      await completeActionMutation.mutateAsync({
        actionId: action.id,
        payload: { status: "completed", txHash },
      });
    } catch (error) {
      await completeActionMutation.mutateAsync({
        actionId: action.id,
        payload: { status: "failed", error: toErrorMessage(error) },
      });
      throw error;
    }
  }

  async function handleGrantAndExecute(options: {
    usdCap: string;
    expiryMinutes: number;
  }) {
    if (!activeAction) {
      return;
    }

    await grantPermissionMutation.mutateAsync({
      action: activeAction,
      usdCap: options.usdCap,
      expiryMinutes: options.expiryMinutes,
    });

    await executeAction(activeAction);
  }

  async function handleCreateAction(payload: ActionDraftPayload) {
    await draftActionMutation.mutateAsync(payload);
  }

  async function handleSend(message: string) {
    await chatMutation.mutateAsync(message);
  }

  return (
    <main className="app-shell">
      <section className="hero-ribbon">
        <div className="hero-ribbon-copy">
          <p className="eyebrow">Private wallet concierge</p>
          <h1>WaaP Agent</h1>
          <p className="hero-ribbon-text">
            Private by default, chat-first, and tuned for guided approvals instead of blind clicks.
          </p>
          <button
            aria-label="Toggle theme"
            className="theme-toggle"
            data-theme={resolvedTheme}
            type="button"
            onClick={toggleTheme}
          >
            <span className="theme-toggle-dot" aria-hidden="true" />
            <span className="theme-toggle-copy">
              <span>Theme</span>
              <strong>{resolvedTheme === "dark" ? "Dark" : "Light"}</strong>
            </span>
          </button>
        </div>
        <div className="hero-ribbon-stats">
          <article className="stat-chip">
            <span>Network</span>
            <strong>Sepolia</strong>
          </article>
          <article className="stat-chip">
            <span>Session</span>
            <strong>{walletAddress ? "Bound" : restoringSession ? "Restoring" : "Idle"}</strong>
          </article>
          <article className="stat-chip">
            <span>Portfolio</span>
            <strong>
              {mergedWalletContext
                ? `${mergedWalletContext.tokenBalances.length} tokens · ${mergedWalletContext.nftAssets.length} NFTs`
                : "--"}
            </strong>
          </article>
          <article className="stat-chip">
            <span>Live balance</span>
            <strong>{balanceQuery.data ? `${balanceQuery.data} ETH` : "--"}</strong>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <WalletPanel
          address={walletAddress}
          balanceEth={balanceQuery.data ?? mergedWalletContext?.nativeBalanceEth ?? null}
          connecting={connectMutation.isPending || disconnectMutation.isPending || restoringSession}
          connected={connected}
          error={connectError}
          nftLoading={walletNftsQuery.isLoading && !nftAssets}
          nftRefreshing={walletNftsQuery.isRefetching}
          selectedNftKey={selectedNftKey}
          walletContext={mergedWalletContext}
          onConnect={() => connectMutation.mutate()}
          onDisconnect={() => disconnectMutation.mutate()}
          onSelectNft={(nextKey) => setSelectedNftKey(nextKey)}
        />
        <ChatPanel
          busy={chatMutation.isPending}
          streaming={streamingAssistantActive}
          streamingMessage={streamingAssistantMessage}
          streamingToolTrace={streamingToolTrace}
          messages={messages}
          suggestions={suggestionPrompts}
          onSend={handleSend}
        />
        <ApprovalPanel
          key={activeAction?.id ?? "empty-approval"}
          action={activeAction}
          busy={combinedBusy}
          selectedNft={selectedNft}
          walletContext={mergedWalletContext}
          onCreateAction={handleCreateAction}
          onGrantAndExecute={handleGrantAndExecute}
          onExecuteReady={() => (activeAction ? executeAction(activeAction) : Promise.resolve())}
        />
      </section>
    </main>
  );
}
