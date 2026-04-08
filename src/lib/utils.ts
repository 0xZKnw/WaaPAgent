import { formatEther, getAddress, isAddress } from "viem";

import type { WalletNftAsset } from "@/lib/types";

export function nowIso() {
  return new Date().toISOString();
}

export function formatAddress(address: string) {
  const safe = getAddress(address);
  return `${safe.slice(0, 6)}...${safe.slice(-4)}`;
}

export function formatEthDisplay(valueWei: string, maximumFractionDigits = 6) {
  const value = Number(formatEther(BigInt(valueWei)));

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

export function formatUsdDisplay(value: string) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatTokenDisplay(value: string, maximumFractionDigits = 6) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatCompactEthBalance(value: string) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  if (amount >= 100) {
    return formatTokenDisplay(value, 2);
  }

  if (amount >= 1) {
    return formatTokenDisplay(value, 4);
  }

  if (amount >= 0.01) {
    return formatTokenDisplay(value, 5);
  }

  return formatTokenDisplay(value, 6);
}

export function formatRelativeExpiry(value: string) {
  const deltaMs = new Date(value).getTime() - Date.now();

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return "expired";
  }

  const totalMinutes = Math.round(deltaMs / 60_000);

  if (totalMinutes < 60) {
    return `${totalMinutes}m left`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!minutes) {
    return `${hours}h left`;
  }

  return `${hours}h ${minutes}m left`;
}

export function isLikelySpamNft(asset: WalletNftAsset) {
  const normalizedName = asset.name.trim().toLowerCase();
  const normalizedCollection = asset.collectionName.trim().toLowerCase();
  const hasRichMetadata = Boolean(asset.imageUrl || asset.animationUrl || asset.externalUrl);
  const hasDescription = Boolean(asset.description?.trim());
  const looksGeneric =
    normalizedCollection.includes("unknown") ||
    normalizedName === `${asset.collectionSymbol.toLowerCase()} #${asset.tokenId}` ||
    normalizedName.includes("voucher") ||
    normalizedName.includes("claim") ||
    normalizedName.includes("airdrop");

  return !hasRichMetadata && !hasDescription && looksGeneric;
}

export function isSameAddress(left: string, right: string) {
  if (!isAddress(left) || !isAddress(right)) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export function minutesToSeconds(value: number) {
  return Math.max(60, Math.floor(value * 60));
}
