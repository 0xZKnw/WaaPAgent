import { formatUnits, getAddress, isAddress } from "viem";

import { env } from "@/lib/env";
import type { WalletTokenBalance } from "@/lib/types";

interface BlockscoutTokenItem {
  value: string;
  token?: {
    name?: string;
    decimals?: string;
    symbol?: string;
    type?: string;
    exchange_rate?: string;
    address_hash?: string;
    icon_url?: string;
  };
}

interface BlockscoutTokenListResponse {
  items: BlockscoutTokenItem[];
}

export class TokenBalanceService {
  async getTokenBalances(address: string): Promise<WalletTokenBalance[]> {
    if (!isAddress(address)) {
      throw new Error("Wallet address is not valid.");
    }

    const response = await fetch(
      `${env.BLOCKSCOUT_API_URL}/addresses/${getAddress(address)}/tokens?type=ERC-20`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    const data = (await response.json().catch(() => null)) as
      | BlockscoutTokenListResponse
      | null;

    if (!response.ok || !data?.items) {
      throw new Error("Could not load token balances from Blockscout.");
    }

    return data.items
      .map((item) => this.mapTokenItem(item))
      .filter((item): item is WalletTokenBalance => item !== null)
      .filter((item) => BigInt(item.balanceRaw) > 0n)
      .sort((left, right) => {
        const leftUsd = Number(left.usdValue || "0");
        const rightUsd = Number(right.usdValue || "0");

        if (leftUsd !== rightUsd) {
          return rightUsd - leftUsd;
        }

        return Number(right.balanceDisplay) - Number(left.balanceDisplay);
      });
  }

  private mapTokenItem(item: BlockscoutTokenItem): WalletTokenBalance | null {
    const token = item.token;

    if (!token?.address_hash || !isAddress(token.address_hash)) {
      return null;
    }

    const decimals = Number(token.decimals || "0");
    const balanceDisplay = formatUnits(BigInt(item.value || "0"), decimals);
    const usdRate = token.exchange_rate ?? null;
    const usdValue =
      usdRate && Number.isFinite(Number(usdRate))
        ? (Number(balanceDisplay) * Number(usdRate)).toFixed(2)
        : null;

    return {
      tokenAddress: getAddress(token.address_hash),
      symbol: token.symbol || "UNKNOWN",
      name: token.name || "Unknown token",
      decimals,
      balanceRaw: item.value || "0",
      balanceDisplay,
      type: token.type || "ERC-20",
      iconUrl: token.icon_url ?? null,
      usdRate,
      usdValue,
    };
  }
}
