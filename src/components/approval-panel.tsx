"use client";

import { useState } from "react";

import type { PendingWalletAction } from "@/lib/types";
import { formatAddress, formatUsdDisplay } from "@/lib/utils";

interface ApprovalPanelProps {
  action: PendingWalletAction | null;
  busy: boolean;
  onGrantAndExecute: (options: { usdCap: string; expiryMinutes: number }) => Promise<void>;
  onExecuteReady: () => Promise<void>;
}

export function ApprovalPanel({
  action,
  busy,
  onGrantAndExecute,
  onExecuteReady,
}: ApprovalPanelProps) {
  const recommendedUsd = action
    ? Math.max(10, Math.ceil(Number(action.estimatedValueUsd || "0") * 1.2))
    : 25;
  const [usdCap, setUsdCap] = useState(String(recommendedUsd));
  const [expiryMinutes, setExpiryMinutes] = useState(30);

  if (!action) {
    return (
      <section className="panel panel-compact">
        <div className="panel-header">
          <p className="eyebrow">Approvals</p>
        </div>
        <div className="approval-empty">
          <p className="mini-value">No pending action</p>
          <p className="micro-copy">
            The next transfer that needs confirmation or a permission window will appear here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-compact">
      <div className="panel-header">
        <p className="eyebrow">Action window</p>
        <span className={`status-dot ${action.canAutoExecute ? "status-live" : ""}`}>
          {action.status}
        </span>
      </div>

      <div className="approval-summary">
        <p className="value-lg">
          {action.type === "token_swap" && action.metadata?.kind === "token_swap"
            ? `${action.metadata.amountInDisplay} ${action.metadata.tokenInSymbol}`
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
            Router: {formatAddress(action.toAddress)}
            {action.metadata.approvalTx ? " | ERC-20 approval required first" : ""}
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
              ? action.type === "token_swap" && action.metadata?.approvalTx
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
              : "Execute with existing permission"}
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
    </section>
  );
}
