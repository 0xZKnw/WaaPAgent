"use client";

import type { WalletContext } from "@/lib/types";
import { formatAddress, formatTokenDisplay, formatUsdDisplay } from "@/lib/utils";

interface WalletPanelProps {
  address: string | null;
  balanceEth: string | null;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  walletContext: WalletContext | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function getRecentActionLabel(
  action: NonNullable<WalletPanelProps["walletContext"]>["recentActions"][number],
) {
  if (action.type === "token_swap" && action.metadata?.kind === "token_swap") {
    return `${action.metadata.amountInDisplay} ${action.metadata.tokenInSymbol} to about ${action.metadata.quotedAmountOutDisplay} ${action.metadata.tokenOutSymbol}`;
  }

  return `${action.valueEth} ETH to ${formatAddress(action.toAddress)}`;
}

export function WalletPanel({
  address,
  balanceEth,
  connecting,
  connected,
  error,
  walletContext,
  onConnect,
  onDisconnect,
}: WalletPanelProps) {
  const activePermission = walletContext?.activePermission;
  const tokenBalances = walletContext?.tokenBalances ?? [];
  const swapAvailable = walletContext?.swapAvailable ?? false;

  return (
    <section className="panel panel-compact">
      <div className="panel-header">
        <p className="eyebrow">Wallet surface</p>
        <span className={`status-dot ${connected ? "status-live" : ""}`}>
          {connected ? "bound" : "offline"}
        </span>
      </div>

      <div className="wallet-radar">
        <div>
          <p className="subtle-label">Address</p>
          <p className="value-xl">{address ? formatAddress(address) : "Not connected"}</p>
        </div>
        <div>
          <p className="subtle-label">Sepolia balance</p>
          <p className="value-lg">{balanceEth ? `${balanceEth} ETH` : "--"}</p>
        </div>
      </div>

      <div className="button-stack">
        <button className="primary-button" onClick={onConnect} disabled={connecting}>
          {connecting ? "Connecting..." : connected ? "Reconnect wallet" : "Connect wallet"}
        </button>
        {connected ? (
          <button className="secondary-button" onClick={onDisconnect} disabled={connecting}>
            Disconnect wallet
          </button>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="mini-grid">
        <article>
          <p className="subtle-label">Agent</p>
          <p className="mini-value">Server-side orchestration with OpenRouter</p>
        </article>
        <article>
          <p className="subtle-label">Swap status</p>
          <p className="mini-value">
            {swapAvailable ? "Direct Uniswap swaps are enabled" : "Swap routing is unavailable"}
          </p>
        </article>
      </div>

      {!swapAvailable ? (
        <p className="micro-copy wallet-note">
          Swap routing is temporarily unavailable. Wallet reads and transfers still work.
        </p>
      ) : (
        <p className="micro-copy wallet-note">
          ETH and USDC swaps run directly against Uniswap contracts on Sepolia. No swap API key is
          required.
        </p>
      )}

      <div className="permission-box">
        <p className="subtle-label">Active permission</p>
        {activePermission ? (
          <>
            <p className="mini-value">
              ${activePermission.maxAmountUsd} until{" "}
              {new Date(activePermission.expiresAt).toLocaleTimeString()}
            </p>
            <p className="micro-copy">
              Allowed destinations: {activePermission.allowedAddresses.map(formatAddress).join(", ")}
            </p>
          </>
        ) : (
          <p className="micro-copy">
            No autonomous window open. The next risky action will go through a permission request.
          </p>
        )}
      </div>

      <div className="recent-actions">
        <p className="subtle-label">Token balances</p>
        {tokenBalances.length ? (
          <div className="action-stack">
            {tokenBalances.map((token) => (
              <div key={token.tokenAddress} className="asset-row">
                <div>
                  <p className="mini-value">
                    {formatTokenDisplay(token.balanceDisplay)} {token.symbol}
                  </p>
                  <p className="micro-copy">{token.name} - {formatAddress(token.tokenAddress)}</p>
                </div>
                <div className="asset-value">
                  {token.usdValue ? <span>{formatUsdDisplay(token.usdValue)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="micro-copy">No ERC-20 token balances detected on Sepolia.</p>
        )}
      </div>

      {walletContext?.recentActions?.length ? (
        <div className="recent-actions">
          <p className="subtle-label">Recent actions</p>
          <div className="action-stack">
            {walletContext.recentActions.map((action) => (
              <div key={action.id} className="action-pill">
                <span className="action-status">{action.status.replace("_", " ")}</span>
                <span className="action-summary">{getRecentActionLabel(action)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
