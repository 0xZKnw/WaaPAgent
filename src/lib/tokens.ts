import { getAddress, isAddress } from "viem";

import { NATIVE_ETH_ADDRESS, SEPOLIA_CHAIN_ID, SEPOLIA_USDC_ADDRESS } from "@/lib/constants";

export interface SupportedToken {
  chainId: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isNative?: boolean;
}

export const supportedSwapTokens: SupportedToken[] = [
  {
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "ETH",
    name: "Ether",
    address: NATIVE_ETH_ADDRESS,
    decimals: 18,
    isNative: true,
  },
  {
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "USDC",
    name: "USD Coin",
    address: getAddress(SEPOLIA_USDC_ADDRESS),
    decimals: 6,
  },
];

export function listSupportedSwapTokens() {
  return supportedSwapTokens;
}

export function resolveSupportedToken(input: string) {
  const normalized = input.trim().toUpperCase();
  const bySymbol = supportedSwapTokens.find((token) => token.symbol === normalized);

  if (bySymbol) {
    return bySymbol;
  }

  if (isAddress(input)) {
    const checksummed = getAddress(input);
    return supportedSwapTokens.find((token) => token.address === checksummed) ?? null;
  }

  return null;
}
