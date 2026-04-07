import { formatEther, getAddress, isAddress } from "viem";

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
