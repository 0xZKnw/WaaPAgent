import { formatEther, getAddress, isAddress, parseEther } from "viem";

import { SEPOLIA_CHAIN_ID } from "@/lib/constants";
import { env } from "@/lib/env";
import { resolveSupportedToken } from "@/lib/tokens";
import type { PendingWalletAction, PermissionGrant } from "@/lib/types";

export interface NativeTransferDraftInput {
  toAddress: string;
  valueWei: string;
  estimatedValueUsd: string;
}

export interface SwapDraftInput {
  quoteTargetAddress: string;
  tokenIn: string;
  tokenOut: string;
  estimatedValueUsd: string;
  slippageBps: number;
}

export interface NftTransferDraftInput {
  recipientAddress: string;
  contractAddress: string;
  tokenId: string;
  tokenType: string;
  quantity?: string;
}

export class PolicyService {
  private readonly maxTransferWei = parseEther(env.MAX_NATIVE_TRANSFER_ETH);
  private readonly maxSwapUsd = Number(env.MAX_SWAP_USD);
  private readonly maxSwapSlippageBps = Number(env.MAX_SWAP_SLIPPAGE_BPS);

  estimateUsdFromWei(valueWei: string) {
    const ethValue = Number(formatEther(BigInt(valueWei)));
    const usdRate = Number(env.ETH_USD_ESTIMATE);
    return (ethValue * usdRate).toFixed(2);
  }

  assertTransferInput(input: NativeTransferDraftInput) {
    if (!isAddress(input.toAddress)) {
      throw new Error("Destination address is not valid.");
    }

    const wei = BigInt(input.valueWei);

    if (wei <= 0n) {
      throw new Error("Transfer value must be greater than zero.");
    }

    if (wei > this.maxTransferWei) {
      throw new Error(
        `Transfer exceeds the local safety cap of ${env.MAX_NATIVE_TRANSFER_ETH} ETH.`,
      );
    }

    return {
      toAddress: getAddress(input.toAddress),
      valueWei: input.valueWei,
      estimatedValueUsd: input.estimatedValueUsd,
    };
  }

  assertSwapInput(input: SwapDraftInput) {
    if (!isAddress(input.quoteTargetAddress)) {
      throw new Error("Swap target address is not valid.");
    }

    const tokenIn = resolveSupportedToken(input.tokenIn);
    const tokenOut = resolveSupportedToken(input.tokenOut);

    if (!tokenIn || !tokenOut) {
      throw new Error("Unsupported swap token.");
    }

    if (tokenIn.address === tokenOut.address) {
      throw new Error("Swap input and output tokens must be different.");
    }

    if (Number(input.estimatedValueUsd) > this.maxSwapUsd) {
      throw new Error(`Swap exceeds the local safety cap of $${env.MAX_SWAP_USD}.`);
    }

    if (input.slippageBps > this.maxSwapSlippageBps) {
      throw new Error(
        `Swap slippage exceeds the local safety cap of ${env.MAX_SWAP_SLIPPAGE_BPS} bps.`,
      );
    }

    return {
      targetAddress: getAddress(input.quoteTargetAddress),
      tokenIn,
      tokenOut,
      estimatedValueUsd: input.estimatedValueUsd,
      slippageBps: input.slippageBps,
    };
  }

  assertNftTransferInput(input: NftTransferDraftInput) {
    if (!isAddress(input.recipientAddress)) {
      throw new Error("NFT recipient address is not valid.");
    }

    if (!isAddress(input.contractAddress)) {
      throw new Error("NFT contract address is not valid.");
    }

    if (!input.tokenId.trim()) {
      throw new Error("NFT token id is required.");
    }

    const quantity = input.quantity?.trim() || "1";

    if (!/^[0-9]+$/.test(quantity) || BigInt(quantity) <= 0n) {
      throw new Error("NFT quantity must be a positive integer.");
    }

    if (input.tokenType !== "ERC-721" && input.tokenType !== "ERC-1155") {
      throw new Error("NFT transfers are limited to ERC-721 and ERC-1155.");
    }

    return {
      recipientAddress: getAddress(input.recipientAddress),
      contractAddress: getAddress(input.contractAddress),
      tokenId: input.tokenId.trim(),
      tokenType: input.tokenType as "ERC-721" | "ERC-1155",
      quantity,
    };
  }

  isGrantValidForAction(
    grant: PermissionGrant | null,
    action: Pick<
      PendingWalletAction,
      "chainId" | "type" | "toAddress" | "estimatedValueUsd"
    >,
  ) {
    if (!grant || grant.status !== "active") {
      return false;
    }

    if (grant.chainId !== SEPOLIA_CHAIN_ID || action.chainId !== SEPOLIA_CHAIN_ID) {
      return false;
    }

    if (grant.actionType !== action.type) {
      return false;
    }

    if (new Date(grant.expiresAt).getTime() <= Date.now()) {
      return false;
    }

    const destinationAllowed = grant.allowedAddresses.some(
      (candidate) => isAddress(candidate) && getAddress(candidate) === getAddress(action.toAddress),
    );

    if (!destinationAllowed) {
      return false;
    }

    return Number(action.estimatedValueUsd) <= Number(grant.maxAmountUsd);
  }
}
