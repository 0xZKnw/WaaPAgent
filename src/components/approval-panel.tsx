"use client";

import { useEffect, useState } from "react";

import type {
  PendingWalletAction,
  WalletContext,
  WalletNftAsset,
} from "@/lib/types";
import { formatAddress, formatUsdDisplay } from "@/lib/utils";

type ActionComposerMode = "review" | "transfer" | "swap" | "nft";

interface ApprovalPanelProps {
  action: PendingWalletAction | null;
  busy: boolean;
  selectedNft: WalletNftAsset | null;
  walletContext: WalletContext | null;
  onCreateAction: (payload:
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
      }) => Promise<void>;
  onGrantAndExecute: (options: { usdCap: string; expiryMinutes: number }) => Promise<void>;
  onExecuteReady: () => Promise<void>;
}

export function ApprovalPanel({
  action,
  busy,
  selectedNft,
  walletContext,
  onCreateAction,
  onGrantAndExecute,
  onExecuteReady,
}: ApprovalPanelProps) {
  const recommendedUsd = action
    ? Math.max(10, Math.ceil(Number(action.estimatedValueUsd || "0") * 1.2))
    : 25;
  const [mode, setMode] = useState<ActionComposerMode>("review");
  const [usdCap, setUsdCap] = useState(String(recommendedUsd));
  const [expiryMinutes, setExpiryMinutes] = useState(30);
  const [transferDraft, setTransferDraft] = useState({
    toAddress: "",
    amountEth: "",
    reason: "",
  });
  const [swapDraft, setSwapDraft] = useState({
    tokenIn: walletContext?.supportedSwapTokens[0]?.symbol ?? "ETH",
    tokenOut:
      walletContext?.supportedSwapTokens.find((token) => token.symbol !== "ETH")?.symbol ?? "USDC",
    amount: "",
    reason: "",
  });
  const [nftDraft, setNftDraft] = useState({
    toAddress: "",
    quantity: "1",
    reason: "",
  });

  useEffect(() => {
    setUsdCap(String(recommendedUsd));
  }, [recommendedUsd]);

  useEffect(() => {
    if (action) {
      setMode("review");
    }
  }, [action]);

  useEffect(() => {
    const defaultTokenIn = walletContext?.supportedSwapTokens[0]?.symbol ?? "ETH";
    const defaultTokenOut =
      walletContext?.supportedSwapTokens.find((token) => token.symbol !== defaultTokenIn)?.symbol ??
      "USDC";

    setSwapDraft((current) => ({
      ...current,
      tokenIn: current.tokenIn || defaultTokenIn,
      tokenOut: current.tokenOut || defaultTokenOut,
    }));
  }, [walletContext?.supportedSwapTokens]);

  async function submitTransferDraft() {
    await onCreateAction({
      type: "native_transfer",
      toAddress: transferDraft.toAddress,
      amountEth: transferDraft.amountEth,
      reason: transferDraft.reason || undefined,
    });
  }

  async function submitSwapDraft() {
    await onCreateAction({
      type: "token_swap",
      tokenIn: swapDraft.tokenIn,
      tokenOut: swapDraft.tokenOut,
      amount: swapDraft.amount,
      reason: swapDraft.reason || undefined,
    });
  }

  async function submitNftDraft() {
    if (!selectedNft) {
      return;
    }

    await onCreateAction({
      type: "nft_transfer",
      contractAddress: selectedNft.contractAddress,
      tokenId: selectedNft.tokenId,
      toAddress: nftDraft.toAddress,
      quantity: selectedNft.tokenType === "ERC-1155" ? nftDraft.quantity : undefined,
      reason: nftDraft.reason || undefined,
    });
  }

  return (
    <section className="panel panel-compact action-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Action deck</p>
          <h2 className="section-title">Prepare or approve</h2>
        </div>
        <span className={`status-dot ${action?.canAutoExecute ? "status-live" : ""}`}>
          {action ? action.status.replace("_", " ") : "idle"}
        </span>
      </div>

      <div className="segment-tabs" role="tablist" aria-label="Action modes">
        {([
          ["review", "Review"],
          ["transfer", "Send ETH"],
          ["swap", "Swap"],
          ["nft", "Send NFT"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`segment-tab ${mode === value ? "segment-tab-active" : ""}`}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "review" ? (
        action ? (
          <>
            <div className="approval-summary">
              <p className="value-lg">
                {action.type === "token_swap" && action.metadata?.kind === "token_swap"
                  ? `${action.metadata.amountInDisplay} ${action.metadata.tokenInSymbol}`
                  : action.type === "nft_transfer" && action.metadata?.kind === "nft_transfer"
                    ? action.metadata.assetName
                    : `${action.valueEth} ETH`}
              </p>
              <p className="mini-value">
                {action.type === "token_swap" && action.metadata?.kind === "token_swap"
                  ? `for about ${action.metadata.quotedAmountOutDisplay} ${action.metadata.tokenOutSymbol}`
                  : `to ${formatAddress(action.toAddress)}`}
              </p>
              <p className="micro-copy">{action.summary}</p>
              {action.type === "token_swap" && action.metadata?.kind === "token_swap" ? (
                <p className="micro-copy">
                  Route: {action.metadata.routeString || "single hop"} ·
                  {action.metadata.approvalTx
                    ? " explicit ERC-20 approval first"
                    : " no separate approval needed"}
                </p>
              ) : null}
              {action.type === "nft_transfer" && action.metadata?.kind === "nft_transfer" ? (
                <p className="micro-copy">
                  {action.metadata.collectionName} · Token #{action.metadata.tokenId}
                  {action.metadata.tokenType === "ERC-1155"
                    ? ` · Quantity ${action.metadata.quantity}`
                    : ""}
                </p>
              ) : null}
            </div>

            <div className="mini-grid">
              <article>
                <p className="subtle-label">USD estimate</p>
                <p className="mini-value">{formatUsdDisplay(action.estimatedValueUsd)}</p>
              </article>
              <article>
                <p className="subtle-label">Mode</p>
                <p className="mini-value">
                  {action.canAutoExecute
                    ? action.type === "token_swap" &&
                      action.metadata?.kind === "token_swap" &&
                      action.metadata.approvalTx
                      ? "Approval then execute"
                      : "Ready to execute"
                    : "Permission required"}
                </p>
              </article>
            </div>

            {action.canAutoExecute ? (
              <button className="primary-button" disabled={busy} onClick={onExecuteReady}>
                {busy
                  ? "Executing..."
                  : action.type === "token_swap"
                    ? "Execute swap"
                    : action.type === "nft_transfer"
                      ? "Transfer NFT"
                      : "Execute action"}
              </button>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    <span className="subtle-label">USD cap</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={usdCap}
                      onChange={(event) => setUsdCap(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="subtle-label">Expiry minutes</span>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      step="1"
                      value={expiryMinutes}
                      onChange={(event) => setExpiryMinutes(Number(event.target.value))}
                    />
                  </label>
                </div>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => onGrantAndExecute({ usdCap, expiryMinutes })}
                >
                  {busy ? "Granting..." : "Grant WaaP permission and execute"}
                </button>
              </>
            )}

            {action.txHash ? (
              <p className="micro-copy">Transaction hash: {action.txHash}</p>
            ) : null}
            {action.error ? <p className="error-text">{action.error}</p> : null}
          </>
        ) : (
          <div className="approval-empty">
            <p className="mini-value">No pending action</p>
            <p className="micro-copy">
              Prepare a transfer, swap, or NFT move from the tabs above, or use the chat to ask in
              natural language.
            </p>
          </div>
        )
      ) : null}

      {mode === "transfer" ? (
        <div className="composer-card">
          <p className="subtle-label">Send ETH</p>
          <div className="form-grid form-grid-single">
            <label>
              <span className="subtle-label">Recipient</span>
              <input
                value={transferDraft.toAddress}
                onChange={(event) =>
                  setTransferDraft((current) => ({ ...current, toAddress: event.target.value }))
                }
                placeholder="0x..."
              />
            </label>
            <label>
              <span className="subtle-label">Amount ETH</span>
              <input
                value={transferDraft.amountEth}
                onChange={(event) =>
                  setTransferDraft((current) => ({ ...current, amountEth: event.target.value }))
                }
                placeholder="0.01"
              />
            </label>
            <label>
              <span className="subtle-label">Reason</span>
              <input
                value={transferDraft.reason}
                onChange={(event) =>
                  setTransferDraft((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Optional note"
              />
            </label>
          </div>
          <button className="primary-button" disabled={busy} onClick={submitTransferDraft}>
            {busy ? "Preparing..." : "Prepare ETH transfer"}
          </button>
        </div>
      ) : null}

      {mode === "swap" ? (
        <div className="composer-card">
          <p className="subtle-label">Swap tokens</p>
          <div className="form-grid form-grid-single">
            <label>
              <span className="subtle-label">From</span>
              <select
                value={swapDraft.tokenIn}
                onChange={(event) =>
                  setSwapDraft((current) => ({ ...current, tokenIn: event.target.value }))
                }
              >
                {walletContext?.supportedSwapTokens.map((token) => (
                  <option key={token.address} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="subtle-label">To</span>
              <select
                value={swapDraft.tokenOut}
                onChange={(event) =>
                  setSwapDraft((current) => ({ ...current, tokenOut: event.target.value }))
                }
              >
                {walletContext?.supportedSwapTokens.map((token) => (
                  <option key={token.address} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="subtle-label">Amount</span>
              <input
                value={swapDraft.amount}
                onChange={(event) =>
                  setSwapDraft((current) => ({ ...current, amount: event.target.value }))
                }
                placeholder="0.01"
              />
            </label>
            <label>
              <span className="subtle-label">Intent</span>
              <input
                value={swapDraft.reason}
                onChange={(event) =>
                  setSwapDraft((current) => ({ ...current, reason: event.target.value }))
                }
                placeholder="Optional note"
              />
            </label>
          </div>
          <p className="micro-copy">
            Supported routes stay limited to the Sepolia allowlist shown in your wallet panel.
          </p>
          <button className="primary-button" disabled={busy} onClick={submitSwapDraft}>
            {busy ? "Preparing..." : "Prepare swap"}
          </button>
        </div>
      ) : null}

      {mode === "nft" ? (
        <div className="composer-card">
          <p className="subtle-label">Send NFT</p>
          {selectedNft ? (
            <>
              <div className="selected-nft-row">
                <div className="selected-nft-copy">
                  <p className="mini-value">{selectedNft.name}</p>
                  <p className="micro-copy">
                    {selectedNft.collectionName} · {selectedNft.tokenType} · #{selectedNft.tokenId}
                  </p>
                </div>
                <span className="micro-pill">
                  {selectedNft.tokenType === "ERC-1155"
                    ? `${selectedNft.balance} owned`
                    : "unique"}
                </span>
              </div>
              <div className="form-grid form-grid-single">
                <label>
                  <span className="subtle-label">Recipient</span>
                  <input
                    value={nftDraft.toAddress}
                    onChange={(event) =>
                      setNftDraft((current) => ({ ...current, toAddress: event.target.value }))
                    }
                    placeholder="0x..."
                  />
                </label>
                {selectedNft.tokenType === "ERC-1155" ? (
                  <label>
                    <span className="subtle-label">Quantity</span>
                    <input
                      value={nftDraft.quantity}
                      onChange={(event) =>
                        setNftDraft((current) => ({ ...current, quantity: event.target.value }))
                      }
                      placeholder="1"
                    />
                  </label>
                ) : null}
                <label>
                  <span className="subtle-label">Reason</span>
                  <input
                    value={nftDraft.reason}
                    onChange={(event) =>
                      setNftDraft((current) => ({ ...current, reason: event.target.value }))
                    }
                    placeholder="Optional note"
                  />
                </label>
              </div>
              <button className="primary-button" disabled={busy} onClick={submitNftDraft}>
                {busy ? "Preparing..." : "Prepare NFT transfer"}
              </button>
            </>
          ) : (
            <div className="approval-empty">
              <p className="mini-value">Select an NFT first</p>
              <p className="micro-copy">
                Choose an NFT from the gallery to prepare a transfer. ERC-721 and ERC-1155 are
                both supported.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
