"use client";

import Image from "next/image";
import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

import type { WalletContext, WalletNftAsset } from "@/lib/types";
import {
  formatAddress,
  formatCompactEthBalance,
  formatRelativeExpiry,
  formatTokenDisplay,
  formatUsdDisplay,
  isLikelySpamNft,
} from "@/lib/utils";

interface WalletPanelProps {
  address: string | null;
  balanceEth: string | null;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  nftLoading: boolean;
  nftRefreshing: boolean;
  selectedNftKey: string | null;
  walletContext: WalletContext | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectNft: (key: string) => void;
}

const EMPTY_TOKEN_BALANCES: NonNullable<WalletContext["tokenBalances"]> = [];
const EMPTY_NFT_ASSETS: WalletNftAsset[] = [];
const EMPTY_SUPPORTED_SWAP_TOKENS: NonNullable<WalletContext["supportedSwapTokens"]> = [];
const NFT_TILE_IMAGE_SIZE = 208;

function getRecentActionLabel(
  action: NonNullable<WalletPanelProps["walletContext"]>["recentActions"][number],
) {
  if (action.type === "token_swap" && action.metadata?.kind === "token_swap") {
    return `${action.metadata.amountInDisplay} ${action.metadata.tokenInSymbol} to about ${action.metadata.quotedAmountOutDisplay} ${action.metadata.tokenOutSymbol}`;
  }

  if (action.type === "nft_transfer" && action.metadata?.kind === "nft_transfer") {
    return action.metadata.tokenType === "ERC-1155"
      ? `${action.metadata.quantity}x ${action.metadata.assetName} to ${formatAddress(action.toAddress)}`
      : `${action.metadata.assetName} to ${formatAddress(action.toAddress)}`;
  }

  return `${action.valueEth} ETH to ${formatAddress(action.toAddress)}`;
}

function getCollectionOptions(assets: WalletNftAsset[]) {
  return Array.from(new Set(assets.map((asset) => asset.collectionName))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function getNftKey(asset: Pick<WalletNftAsset, "contractAddress" | "tokenId">) {
  return `${asset.contractAddress}:${asset.tokenId}`;
}

function buildSearchableNft(asset: WalletNftAsset) {
  return {
    asset,
    key: getNftKey(asset),
    normalizedName: asset.name.toLowerCase(),
    normalizedCollection: asset.collectionName.toLowerCase(),
    normalizedTokenId: asset.tokenId.toLowerCase(),
    isSpam: isLikelySpamNft(asset),
  };
}

function getOptimizedNftImageUrl(imageUrl: string) {
  return `/api/nft-image?src=${encodeURIComponent(imageUrl)}`;
}

const NftTileCard = memo(function NftTileCard({
  nft,
  active,
  onSelect,
  showArtwork,
}: {
  nft: WalletNftAsset;
  active: boolean;
  onSelect: (key: string) => void;
  showArtwork: boolean;
}) {
  const key = getNftKey(nft);

  return (
    <button
      type="button"
      className={`nft-tile ${active ? "nft-tile-active" : ""}`}
      onClick={() => onSelect(key)}
    >
      {showArtwork ? (
        <div className="nft-media">
          {nft.imageUrl ? (
            <Image
              src={getOptimizedNftImageUrl(nft.imageUrl)}
              alt={nft.name}
              width={NFT_TILE_IMAGE_SIZE}
              height={NFT_TILE_IMAGE_SIZE}
              sizes="112px"
              quality={60}
              loading="lazy"
              draggable="false"
            />
          ) : (
            <div className="nft-media-fallback">{nft.collectionSymbol.slice(0, 2)}</div>
          )}
        </div>
      ) : null}
      <div className="nft-tile-copy">
        <p className="nft-title">{nft.name}</p>
        <p className="micro-copy">
          {nft.collectionName} #{nft.tokenId}
        </p>
      </div>
    </button>
  );
});

const NftDetailCard = memo(function NftDetailCard({
  nft,
}: {
  nft: WalletNftAsset;
}) {
  return (
    <div className="nft-focus-card">
      <div className="nft-focus-copy">
        <p className="subtle-label">{nft.tokenType}</p>
        <p className="value-lg">{nft.name}</p>
        <div className="nft-detail-list">
          <div className="nft-detail-row">
            <span>Collection</span>
            <strong>{nft.collectionName}</strong>
          </div>
          <div className="nft-detail-row">
            <span>Token</span>
            <strong>#{nft.tokenId}</strong>
          </div>
          <div className="nft-detail-row">
            <span>Type</span>
            <strong>{nft.tokenType === "ERC-1155" ? `Balance ${nft.balance}` : "Unique"}</strong>
          </div>
        </div>
        {nft.description ? <p className="micro-copy">{nft.description}</p> : null}
      </div>
    </div>
  );
});

export function WalletPanel({
  address,
  balanceEth,
  connecting,
  connected,
  error,
  nftLoading,
  nftRefreshing,
  selectedNftKey,
  walletContext,
  onConnect,
  onDisconnect,
  onSelectNft,
}: WalletPanelProps) {
  const [collectionQuery, setCollectionQuery] = useState("");
  const [nftQuery, setNftQuery] = useState("");
  const [hideSpam, setHideSpam] = useState(true);
  const [showNftArtwork, setShowNftArtwork] = useState(true);

  const activePermission = walletContext?.activePermission;
  const tokenBalances = walletContext?.tokenBalances ?? EMPTY_TOKEN_BALANCES;
  const nftAssets = walletContext?.nftAssets ?? EMPTY_NFT_ASSETS;
  const swapAvailable = walletContext?.swapAvailable ?? false;
  const supportedTokens = walletContext?.supportedSwapTokens ?? EMPTY_SUPPORTED_SWAP_TOKENS;
  const deferredNftQuery = useDeferredValue(nftQuery);
  const deferredCollectionQuery = useDeferredValue(collectionQuery);
  const normalizedNftQuery = deferredNftQuery.trim().toLowerCase();
  const normalizedCollectionQuery = deferredCollectionQuery.trim().toLowerCase();
  const searchableNfts = useMemo(() => nftAssets.map(buildSearchableNft), [nftAssets]);
  const collectionOptions = useMemo(() => getCollectionOptions(nftAssets), [nftAssets]);

  const collectionSuggestions = useMemo(() => {
    if (!normalizedCollectionQuery) {
      return collectionOptions.slice(0, 8);
    }

    return collectionOptions
      .filter((collection) => collection.toLowerCase().includes(normalizedCollectionQuery))
      .slice(0, 8);
  }, [collectionOptions, normalizedCollectionQuery]);

  const visibleNfts = useMemo(
    () =>
      searchableNfts
        .filter((item) => {
          if (hideSpam && item.isSpam) {
            return false;
          }

          if (
            normalizedCollectionQuery &&
            !item.normalizedCollection.includes(normalizedCollectionQuery)
          ) {
            return false;
          }

          if (!normalizedNftQuery) {
            return true;
          }

          return (
            item.normalizedName.includes(normalizedNftQuery) ||
            item.normalizedCollection.includes(normalizedNftQuery) ||
            item.normalizedTokenId.includes(normalizedNftQuery)
          );
        })
        .map((item) => item.asset),
    [hideSpam, normalizedCollectionQuery, normalizedNftQuery, searchableNfts],
  );

  const visibleGridNfts = useMemo(() => visibleNfts.slice(0, 6), [visibleNfts]);

  const selectedNft = useMemo(
    () => visibleNfts.find((asset) => getNftKey(asset) === selectedNftKey) ?? null,
    [selectedNftKey, visibleNfts],
  );

  const fallbackSelectedNft = useMemo(
    () =>
      selectedNft ??
      nftAssets.find((asset) => getNftKey(asset) === selectedNftKey) ??
      visibleGridNfts[0] ??
      nftAssets[0] ??
      null,
    [nftAssets, selectedNft, selectedNftKey, visibleGridNfts],
  );

  const handleCollectionQueryChange = useCallback((value: string) => {
    setCollectionQuery(value);
  }, []);

  const handleNftQueryChange = useCallback((value: string) => {
    setNftQuery(value);
  }, []);

  const handleHideSpamChange = useCallback((checked: boolean) => {
    setHideSpam(checked);
  }, []);

  const handleArtworkToggle = useCallback((checked: boolean) => {
    setShowNftArtwork(checked);
  }, []);

  const handleSelectNft = useCallback(
    (key: string) => {
      onSelectNft(key);
    },
    [onSelectNft],
  );

  return (
    <section className="panel panel-compact wallet-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Wallet surface</p>
          <h2 className="section-title">Portfolio</h2>
        </div>
        <span className={`status-dot ${connected ? "status-live" : ""}`}>
          {connected ? "bound" : "offline"}
        </span>
      </div>

      <div className="wallet-radar">
        <div className="wallet-radar-main">
          <p className="subtle-label">Address</p>
          <p className="value-xl">{address ? formatAddress(address) : "Not connected"}</p>
          <p className="micro-copy">
            {supportedTokens.length
              ? `Swap universe: ${supportedTokens.map((token) => token.symbol).join(" - ")}`
              : "Wallet actions are scoped to Sepolia."}
          </p>
        </div>
        <div className="wallet-radar-stats">
          <article>
            <span className="subtle-label">Native</span>
            <strong>{balanceEth ? `${formatCompactEthBalance(balanceEth)} ETH` : "--"}</strong>
          </article>
          <article>
            <span className="subtle-label">Tokens</span>
            <strong>{tokenBalances.length}</strong>
          </article>
          <article>
            <span className="subtle-label">NFTs</span>
            <strong>{nftAssets.length}</strong>
          </article>
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
            {swapAvailable ? "Direct routes are live" : "Swap routing is unavailable"}
          </p>
        </article>
      </div>

      <div className="permission-box">
        <p className="subtle-label">Active permission</p>
        {activePermission ? (
          <>
            <p className="mini-value">
              ${activePermission.maxAmountUsd} - {formatRelativeExpiry(activePermission.expiresAt)}
            </p>
            <p className="micro-copy">
              Scope: {activePermission.actionType.replace("_", " ")} to{" "}
              {activePermission.allowedAddresses.map(formatAddress).join(", ")}
            </p>
          </>
        ) : (
          <p className="micro-copy">
            No autonomous window open. The next risky action will go through a permission request.
          </p>
        )}
      </div>

      <div className="portfolio-block">
        <div className="block-heading">
          <p className="subtle-label">Token balances</p>
          <span className="micro-pill">{tokenBalances.length} assets</span>
        </div>
        {tokenBalances.length ? (
          <div className="asset-stack">
            {tokenBalances.slice(0, 6).map((token) => (
              <div key={token.tokenAddress} className="asset-row">
                <div>
                  <p className="mini-value">
                    {formatTokenDisplay(token.balanceDisplay)} {token.symbol}
                  </p>
                  <p className="micro-copy">
                    {token.name} - {formatAddress(token.tokenAddress)}
                  </p>
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

      <div className="portfolio-block nft-block">
        <div className="block-heading">
          <p className="subtle-label">NFT gallery</p>
          <span className="micro-pill">
            {nftLoading
              ? "loading"
              : nftRefreshing
                ? "refreshing"
                : `${visibleNfts.length} visible`}
          </span>
        </div>

        <div className="nft-toolbar">
          <input
            value={nftQuery}
            onChange={(event) => handleNftQueryChange(event.target.value)}
            placeholder="Search by name, collection or token id"
            aria-label="Search NFTs"
          />
          <input
            value={collectionQuery}
            onChange={(event) => handleCollectionQueryChange(event.target.value)}
            placeholder="Filter by collection"
            aria-label="Filter NFTs by collection"
          />
        </div>

        <div className="collection-chip-row">
          <button
            type="button"
            className={`collection-chip ${!collectionQuery.trim() ? "collection-chip-active" : ""}`}
            onClick={() => handleCollectionQueryChange("")}
          >
            All collections
          </button>
          {collectionSuggestions.map((collection) => (
            <button
              key={collection}
              type="button"
              className={`collection-chip ${
                collection.toLowerCase() === normalizedCollectionQuery ? "collection-chip-active" : ""
              }`}
              onClick={() => handleCollectionQueryChange(collection)}
            >
              {collection}
            </button>
          ))}
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideSpam}
            onChange={(event) => handleHideSpamChange(event.target.checked)}
          />
          <span>Hide probable spam collections</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showNftArtwork}
            onChange={(event) => handleArtworkToggle(event.target.checked)}
          />
          <span>Show NFT artwork</span>
        </label>

        {nftLoading && !nftAssets.length ? (
          <p className="micro-copy">Loading NFT inventory in the background...</p>
        ) : visibleNfts.length ? (
          <>
            <div className="nft-grid">
              {visibleGridNfts.map((nft) => (
                <NftTileCard
                  key={getNftKey(nft)}
                  nft={nft}
                  active={Boolean(
                    fallbackSelectedNft && getNftKey(fallbackSelectedNft) === getNftKey(nft),
                  )}
                  onSelect={handleSelectNft}
                  showArtwork={showNftArtwork}
                />
              ))}
            </div>

            {fallbackSelectedNft ? <NftDetailCard nft={fallbackSelectedNft} /> : null}
          </>
        ) : (
          <p className="micro-copy">No NFT assets match the current filters.</p>
        )}
      </div>

      {walletContext?.recentActions?.length ? (
        <div className="portfolio-block">
          <div className="block-heading">
            <p className="subtle-label">Recent actions</p>
            <span className="micro-pill">{walletContext.recentActions.length} entries</span>
          </div>
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
