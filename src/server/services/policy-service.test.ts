import { describe, expect, test } from "bun:test";
import { parseEther } from "viem";

import type { PendingWalletAction, PermissionGrant } from "@/lib/types";
import { PolicyService } from "@/server/services/policy-service";

const policy = new PolicyService();

function createGrant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    id: "grant-1",
    chainId: 11155111,
    actionType: "native_transfer",
    allowedAddresses: ["0x1111111111111111111111111111111111111111"],
    maxAmountUsd: "50",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    status: "active",
    ...overrides,
  };
}

function createAction(overrides: Partial<PendingWalletAction> = {}): PendingWalletAction {
  return {
    id: "action-1",
    type: "native_transfer",
    status: "needs_approval",
    chainId: 11155111,
    toAddress: "0x1111111111111111111111111111111111111111",
    valueWei: parseEther("0.01").toString(),
    valueEth: "0.01",
    estimatedValueUsd: "25.00",
    summary: "Send 0.01 ETH",
    reason: null,
    requiresPermission: true,
    canAutoExecute: false,
    txHash: null,
    error: null,
    permissionGrantId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PolicyService", () => {
  test("estimates USD from wei using the configured hint", () => {
    expect(policy.estimateUsdFromWei(parseEther("0.01").toString())).toBe("25.00");
  });

  test("rejects invalid destination addresses", () => {
    expect(() =>
      policy.assertTransferInput({
        toAddress: "not-an-address",
        valueWei: parseEther("0.01").toString(),
        estimatedValueUsd: "25.00",
      }),
    ).toThrow("Destination address is not valid.");
  });

  test("rejects transfers above the local ETH cap", () => {
    expect(() =>
      policy.assertTransferInput({
        toAddress: "0x1111111111111111111111111111111111111111",
        valueWei: parseEther("1").toString(),
        estimatedValueUsd: "2500.00",
      }),
    ).toThrow("Transfer exceeds the local safety cap");
  });

  test("accepts a matching permission grant", () => {
    expect(policy.isGrantValidForAction(createGrant(), createAction())).toBe(true);
  });

  test("accepts a supported swap preview within caps", () => {
    const result = policy.assertSwapInput({
      quoteTargetAddress: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
      tokenIn: "ETH",
      tokenOut: "USDC",
      estimatedValueUsd: "25.00",
      slippageBps: 100,
    });

    expect(result.tokenIn.symbol).toBe("ETH");
    expect(result.tokenOut.symbol).toBe("USDC");
  });

  test("accepts valid ERC-721 and ERC-1155 NFT transfer previews", () => {
    const result = policy.assertNftTransferInput({
      recipientAddress: "0x1111111111111111111111111111111111111111",
      contractAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "42",
      tokenType: "ERC-721",
    });

    expect(result.tokenId).toBe("42");
    expect(result.quantity).toBe("1");

    const erc1155Result = policy.assertNftTransferInput({
      recipientAddress: "0x1111111111111111111111111111111111111111",
      contractAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "42",
      tokenType: "ERC-1155",
      quantity: "3",
    });

    expect(erc1155Result.quantity).toBe("3");
    expect(erc1155Result.tokenType).toBe("ERC-1155");
  });

  test("rejects invalid NFT quantities", () => {
    expect(() =>
      policy.assertNftTransferInput({
        recipientAddress: "0x1111111111111111111111111111111111111111",
        contractAddress: "0x2222222222222222222222222222222222222222",
        tokenId: "42",
        tokenType: "ERC-1155",
        quantity: "0",
      }),
    ).toThrow("NFT quantity must be a positive integer.");
  });

  test("rejects unsupported or oversized swaps", () => {
    expect(() =>
      policy.assertSwapInput({
        quoteTargetAddress: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
        tokenIn: "ETH",
        tokenOut: "DAI",
        estimatedValueUsd: "25.00",
        slippageBps: 100,
      }),
    ).toThrow("Unsupported swap token.");

    expect(() =>
      policy.assertSwapInput({
        quoteTargetAddress: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
        tokenIn: "ETH",
        tokenOut: "USDC",
        estimatedValueUsd: "999999.00",
        slippageBps: 100,
      }),
    ).toThrow("Swap exceeds the local safety cap");
  });

  test("rejects grants that do not allow the destination or amount", () => {
    expect(
      policy.isGrantValidForAction(
        createGrant({
          allowedAddresses: ["0x2222222222222222222222222222222222222222"],
        }),
        createAction(),
      ),
    ).toBe(false);

    expect(
      policy.isGrantValidForAction(
        createGrant({
          maxAmountUsd: "5",
        }),
        createAction(),
      ),
    ).toBe(false);
  });
});
