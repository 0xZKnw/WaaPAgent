import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
} from "viem";
import { sepolia } from "viem/chains";

import {
  DEFAULT_RPC_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_WETH_ADDRESS,
  UNISWAP_QUOTER_V2_ADDRESS,
  UNISWAP_SWAP_ROUTER_02_ADDRESS,
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_FEE_TIERS,
} from "@/lib/constants";
import { env } from "@/lib/env";
import { listSupportedSwapTokens, resolveSupportedToken } from "@/lib/tokens";
import type { PreparedOnchainTransaction, SupportedSwapToken } from "@/lib/types";

interface QuoteCandidate {
  amountOut: bigint;
  fee: number;
  poolAddress: string;
  gasEstimate: bigint;
}

export interface ExactInputSwapIntent {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
}

export interface ExactInputSwapQuote {
  tokenIn: SupportedSwapToken;
  tokenOut: SupportedSwapToken;
  amountInRaw: string;
  amountInDisplay: string;
  quotedAmountOutRaw: string;
  quotedAmountOutDisplay: string;
  quoteId: string | null;
  routeString: string | null;
  slippageBps: number;
  estimatedValueUsd: string;
  approvalTx: PreparedOnchainTransaction | null;
  swapTx: PreparedOnchainTransaction;
}

const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

const swapRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
]);

const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

const DEFAULT_SWAP_SLIPPAGE_BPS = 100;

export class UniswapTradeService {
  private readonly publicClient = createPublicClient({
    chain: sepolia,
    transport: http(env.SEPOLIA_RPC_URL || DEFAULT_RPC_URL),
  });

  isConfigured() {
    return true;
  }

  listSupportedTokens() {
    return listSupportedSwapTokens();
  }

  resolveToken(input: string) {
    const token = resolveSupportedToken(input);

    if (!token) {
      throw new Error(
        "Unsupported swap token. For now, swaps are limited to the supported Sepolia allowlist.",
      );
    }

    return token;
  }

  async createExactInputSwap(intent: ExactInputSwapIntent): Promise<ExactInputSwapQuote> {
    if (!isAddress(intent.walletAddress)) {
      throw new Error("Wallet address is not valid.");
    }

    const walletAddress = getAddress(intent.walletAddress);
    const tokenIn = this.resolveToken(intent.tokenIn);
    const tokenOut = this.resolveToken(intent.tokenOut);

    if (tokenIn.address === tokenOut.address) {
      throw new Error("The input token and output token must be different.");
    }

    const amountInRaw = parseUnits(intent.amount, tokenIn.decimals).toString();

    if (BigInt(amountInRaw) <= 0n) {
      throw new Error("Swap amount must be greater than zero.");
    }

    const tokenInAddress = getAddress(tokenIn.isNative ? SEPOLIA_WETH_ADDRESS : tokenIn.address);
    const tokenOutAddress = getAddress(tokenOut.isNative ? SEPOLIA_WETH_ADDRESS : tokenOut.address);
    const bestQuote = await this.findBestQuote(tokenInAddress, tokenOutAddress, amountInRaw);

    if (!bestQuote) {
      throw new Error("No supported Uniswap V3 pool with liquidity was found for this pair on Sepolia.");
    }

    const slippageBps = Math.min(DEFAULT_SWAP_SLIPPAGE_BPS, Number(env.MAX_SWAP_SLIPPAGE_BPS));
    const quotedAmountOutRaw = bestQuote.amountOut.toString();
    const quotedAmountOutDisplay = formatUnits(bestQuote.amountOut, tokenOut.decimals);
    const amountOutMinimum = this.applySlippage(bestQuote.amountOut, slippageBps);
    const approvalTx = tokenIn.isNative
      ? null
      : await this.buildApprovalTx(walletAddress, tokenInAddress, amountInRaw);
    const swapTx = this.buildSwapTx({
      walletAddress,
      tokenInAddress,
      tokenOutAddress,
      amountInRaw,
      amountOutMinimum: amountOutMinimum.toString(),
      fee: bestQuote.fee,
      nativeInput: Boolean(tokenIn.isNative),
      nativeOutput: Boolean(tokenOut.isNative),
    });

    return {
      tokenIn,
      tokenOut,
      amountInRaw,
      amountInDisplay: intent.amount,
      quotedAmountOutRaw,
      quotedAmountOutDisplay,
      quoteId: null,
      routeString: `Single-hop Uniswap v3 pool at ${this.formatFeeTier(bestQuote.fee)} fee`,
      slippageBps,
      estimatedValueUsd: this.estimateInputValueUsd(tokenIn, intent.amount),
      approvalTx,
      swapTx,
    };
  }

  private estimateInputValueUsd(tokenIn: SupportedSwapToken, amountDisplay: string) {
    const amount = Number(amountDisplay);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Swap amount is not valid.");
    }

    if (tokenIn.symbol === "USDC") {
      return amount.toFixed(2);
    }

    return (amount * Number(env.ETH_USD_ESTIMATE)).toFixed(2);
  }

  private async findBestQuote(
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountInRaw: string,
  ) {
    const amountIn = BigInt(amountInRaw);
    const candidates: QuoteCandidate[] = [];

    for (const fee of UNISWAP_V3_FEE_TIERS) {
      const poolAddress = await this.getPoolAddress(tokenIn, tokenOut, fee);

      if (!poolAddress) {
        continue;
      }

      try {
        const data = encodeFunctionData({
          abi: quoterV2Abi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              tokenIn,
              tokenOut,
              amountIn,
              fee,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });

        const result = await this.publicClient.call({
          to: UNISWAP_QUOTER_V2_ADDRESS,
          data,
        });

        if (!result.data) {
          continue;
        }

        const [amountOut, , , gasEstimate] = decodeFunctionResult({
          abi: quoterV2Abi,
          functionName: "quoteExactInputSingle",
          data: result.data,
        });

        if (amountOut > 0n) {
          candidates.push({
            amountOut,
            fee,
            poolAddress,
            gasEstimate,
          });
        }
      } catch {
        continue;
      }
    }

    if (!candidates.length) {
      return null;
    }

    return candidates.sort((left, right) => {
      if (left.amountOut === right.amountOut) {
        return left.gasEstimate < right.gasEstimate ? -1 : 1;
      }

      return left.amountOut > right.amountOut ? -1 : 1;
    })[0];
  }

  private async getPoolAddress(
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    fee: number,
  ) {
    const data = encodeFunctionData({
      abi: factoryAbi,
      functionName: "getPool",
      args: [tokenIn, tokenOut, fee],
    });

    const result = await this.publicClient.call({
      to: UNISWAP_V3_FACTORY_ADDRESS,
      data,
    });

    if (!result.data) {
      return null;
    }

    const poolAddress = decodeFunctionResult({
      abi: factoryAbi,
      functionName: "getPool",
      data: result.data,
    });

    return poolAddress === "0x0000000000000000000000000000000000000000"
      ? null
      : getAddress(poolAddress);
  }

  private async buildApprovalTx(
    walletAddress: `0x${string}`,
    tokenAddress: `0x${string}`,
    amountInRaw: string,
  ): Promise<PreparedOnchainTransaction | null> {
    const allowance = await this.publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletAddress as `0x${string}`, UNISWAP_SWAP_ROUTER_02_ADDRESS as `0x${string}`],
    });

    if (allowance >= BigInt(amountInRaw)) {
      return null;
    }

    return {
      to: tokenAddress,
      chainId: SEPOLIA_CHAIN_ID,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [UNISWAP_SWAP_ROUTER_02_ADDRESS, BigInt(amountInRaw)],
      }),
    };
  }

  private buildSwapTx(input: {
    walletAddress: `0x${string}`;
    tokenInAddress: `0x${string}`;
    tokenOutAddress: `0x${string}`;
    amountInRaw: string;
    amountOutMinimum: string;
    fee: number;
    nativeInput: boolean;
    nativeOutput: boolean;
  }): PreparedOnchainTransaction {
    const exactInputSingleData = encodeFunctionData({
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: input.tokenInAddress,
          tokenOut: input.tokenOutAddress,
          fee: input.fee,
          recipient: input.nativeOutput
            ? UNISWAP_SWAP_ROUTER_02_ADDRESS
            : input.walletAddress,
          amountIn: BigInt(input.amountInRaw),
          amountOutMinimum: BigInt(input.amountOutMinimum),
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const data = input.nativeOutput
      ? encodeFunctionData({
          abi: swapRouterAbi,
          functionName: "multicall",
          args: [
            [
              exactInputSingleData,
              encodeFunctionData({
                abi: swapRouterAbi,
                functionName: "unwrapWETH9",
                args: [BigInt(input.amountOutMinimum), input.walletAddress],
              }),
            ],
          ],
        })
      : exactInputSingleData;

    return {
      to: UNISWAP_SWAP_ROUTER_02_ADDRESS,
      chainId: SEPOLIA_CHAIN_ID,
      value: input.nativeInput ? input.amountInRaw : "0",
      data,
    };
  }

  private applySlippage(amountOut: bigint, slippageBps: number) {
    const cappedBps = BigInt(Math.max(0, Math.min(10_000, slippageBps)));
    return (amountOut * (10_000n - cappedBps)) / 10_000n;
  }

  private formatFeeTier(fee: number) {
    return `${(fee / 10_000).toFixed(2)}%`;
  }
}
