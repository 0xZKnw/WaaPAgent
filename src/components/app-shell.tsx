"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { createPublicClient, formatEther, http, toHex } from "viem";
import { sepolia } from "viem/chains";
import { useEffect, useState } from "react";

import { ApprovalPanel } from "@/components/approval-panel";
import { ChatPanel } from "@/components/chat-panel";
import { WalletPanel } from "@/components/wallet-panel";
import { SEPOLIA_CHAIN_ID } from "@/lib/constants";
import { publicEnv } from "@/lib/env";
import { ensureWaap, switchToSepolia } from "@/lib/browser/waap";
import type {
  ChatMessage,
  ChatResponse,
  PendingWalletAction,
  PreparedOnchainTransaction,
  WalletContext,
} from "@/lib/types";
import { minutesToSeconds, nowIso, toErrorMessage } from "@/lib/utils";

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(publicEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL),
});

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
        | { type: "final"; response: T }
        | { type: "error"; error: string };

      if (chunk.type === "delta") {
        handlers.onDelta(chunk.delta);
      } else if (chunk.type === "final") {
        finalResponse = chunk.response;
      } else if (chunk.type === "error") {
        throw new Error(chunk.error);
      }
    }
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer) as { type: "final"; response: T } | { type: "error"; error: string };

    if (chunk.type === "final") {
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

export function AppShell() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletContext, setWalletContext] = useState<WalletContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeAction, setActiveAction] = useState<PendingWalletAction | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState("");
  const [streamingAssistantActive, setStreamingAssistantActive] = useState(false);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const waap = await ensureWaap();

      setConnectError(null);

      const loginResult = await waap.login();

      if (!loginResult) {
        throw new Error("Human Wallet login was cancelled before the session started.");
      }

      let accounts = (await waap.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts[0]) {
        accounts = (await waap.request({
          method: "eth_accounts",
        })) as string[];
      }

      const address = accounts[0];

      if (!address) {
        throw new Error(
          "Human Wallet opened but no address came back. Finish the WaaP auth flow, then try again.",
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
    onSuccess: ({ address, walletContext }) => {
      setWalletAddress(address);
      setConnected(true);
      setConnectError(null);
      setWalletContext(walletContext);
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
        },
      ),
    onMutate: async (message) => {
      setStreamingAssistantActive(true);
      setStreamingAssistantMessage("");
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
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.message,
          createdAt: nowIso(),
        },
      ]);
      setWalletContext(response.walletContext);
      setActiveAction(response.pendingAction);
    },
    onError: (error) => {
      setStreamingAssistantActive(false);
      setStreamingAssistantMessage("");
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
      balanceQuery.refetch();
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

      return postJson<{ walletContext: WalletContext }>(`/api/permissions/grant`, {
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
    },
  });

  const combinedBusy =
    restoringSession ||
    connectMutation.isPending ||
    chatMutation.isPending ||
    grantPermissionMutation.isPending ||
    confirmActionMutation.isPending ||
    completeActionMutation.isPending;

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const waap = await ensureWaap();
      await waap.logout();
      await postJson("/api/auth/logout");
    },
    onSuccess: () => {
      setWalletAddress(null);
      setWalletContext(null);
      setActiveAction(null);
      setConnected(false);
      setConnectError(null);
      setMessages([]);
    },
    onError: (error) => {
      setConnectError(toErrorMessage(error));
    },
  });

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const waap = await ensureWaap();
        const loginMethod = waap.getLoginMethod();

        if (!loginMethod) {
          return;
        }

        const accounts = (await waap.request({
          method: "eth_requestAccounts",
        })) as string[];

        const address =
          accounts[0] ||
          (
            (await waap.request({
              method: "eth_accounts",
            })) as string[]
          )[0];

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

  async function handleSend(message: string) {
    await chatMutation.mutateAsync(message);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="topbar-copy">
          <p className="eyebrow">Wallet-native copilot</p>
          <h1>Chat, inspect, approve.</h1>
          <p className="topbar-text">
            The model stays server-side. Your wallet stays yours. Risky actions still require a
            permission window.
          </p>
        </div>
        <div className="topbar-metrics">
          <article className="metric-card">
            <span>Network</span>
            <strong>Sepolia</strong>
          </article>
          <article className="metric-card">
            <span>Wallet</span>
            <strong>{walletAddress ? "Connected" : restoringSession ? "Restoring" : "Waiting"}</strong>
          </article>
          <article className="metric-card">
            <span>Balance</span>
            <strong>{balanceQuery.data ? `${balanceQuery.data} ETH` : "--"}</strong>
          </article>
          <article className="metric-card">
            <span>Action</span>
            <strong>{activeAction ? activeAction.status.replace("_", " ") : "Idle"}</strong>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <WalletPanel
          address={walletAddress}
          balanceEth={balanceQuery.data ?? null}
          connecting={connectMutation.isPending || disconnectMutation.isPending || restoringSession}
          connected={connected}
          error={connectError}
          walletContext={walletContext}
          onConnect={() => connectMutation.mutate()}
          onDisconnect={() => disconnectMutation.mutate()}
        />
        <ChatPanel
          busy={chatMutation.isPending}
          streaming={streamingAssistantActive}
          streamingMessage={streamingAssistantMessage}
          messages={messages}
          onSend={handleSend}
        />
        <ApprovalPanel
          key={activeAction?.id ?? "empty-approval"}
          action={activeAction}
          busy={combinedBusy}
          onGrantAndExecute={handleGrantAndExecute}
          onExecuteReady={() => (activeAction ? executeAction(activeAction) : Promise.resolve())}
        />
      </section>
    </main>
  );
}
