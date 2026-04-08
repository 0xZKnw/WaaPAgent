import { getAddress, isAddress } from "viem";

import { env } from "@/lib/env";
import type { WalletNftAsset } from "@/lib/types";

interface BlockscoutOwnedNftItem {
  is_unique?: boolean;
  id?: string;
  token_type?: string;
  value?: string;
  image_url?: string;
  animation_url?: string;
  external_app_url?: string;
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
    image_url?: string;
    external_url?: string;
  } | null;
  token?: {
    address_hash?: string;
    name?: string;
    symbol?: string;
  } | null;
}

interface BlockscoutOwnedNftResponse {
  items: BlockscoutOwnedNftItem[];
}

export class NftAssetService {
  async getOwnedNfts(address: string): Promise<WalletNftAsset[]> {
    if (!isAddress(address)) {
      throw new Error("Wallet address is not valid.");
    }

    const response = await fetch(
      `${env.BLOCKSCOUT_API_URL}/addresses/${getAddress(address)}/nft?type=ERC-721,ERC-1155`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    const data = (await response.json().catch(() => null)) as
      | BlockscoutOwnedNftResponse
      | null;

    if (!response.ok || !data?.items) {
      throw new Error("Could not load NFT assets from Blockscout.");
    }

    return data.items
      .map((item) => this.mapOwnedNftItem(item))
      .filter((item): item is WalletNftAsset => item !== null)
      .sort((left, right) => {
        if (left.collectionName !== right.collectionName) {
          return left.collectionName.localeCompare(right.collectionName);
        }

        return left.name.localeCompare(right.name);
      });
  }

  async findOwnedNft(address: string, contractAddress: string, tokenId: string) {
    const ownedNfts = await this.getOwnedNfts(address);
    const checksummedContract = getAddress(contractAddress);

    return (
      ownedNfts.find(
        (item) =>
          item.contractAddress === checksummedContract && item.tokenId === tokenId.trim(),
      ) ?? null
    );
  }

  private mapOwnedNftItem(item: BlockscoutOwnedNftItem): WalletNftAsset | null {
    if (!item.token?.address_hash || !isAddress(item.token.address_hash) || !item.id) {
      return null;
    }

    const metadataName = item.metadata?.name?.trim();
    const collectionName = item.token.name?.trim() || "Unknown collection";
    const collectionSymbol = item.token.symbol?.trim() || "NFT";
    const imageUrl =
      item.image_url ||
      item.metadata?.image_url ||
      item.metadata?.image ||
      null;

    return {
      contractAddress: getAddress(item.token.address_hash),
      tokenId: item.id,
      tokenType: item.token_type || "ERC-721",
      collectionName,
      collectionSymbol,
      name: metadataName || `${collectionSymbol} #${item.id}`,
      description: item.metadata?.description ?? null,
      balance: item.value || "1",
      isUnique: Boolean(item.is_unique ?? item.token_type === "ERC-721"),
      imageUrl,
      animationUrl: item.animation_url ?? null,
      externalUrl: item.external_app_url || item.metadata?.external_url || null,
    };
  }
}
