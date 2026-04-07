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
