import { expect, test } from "@playwright/test";

const walletAddress = "0x1111111111111111111111111111111111111111";
const targetAddress = "0x2222222222222222222222222222222222222222";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([address]) => {
      window.__waapInitialized = true;
      window.waap = {
        getLoginMethod: () => null,
        login: async () => "waap",
        request: async (args: { method: string; params?: unknown[] }) => {
          switch (args.method) {
            case "eth_requestAccounts":
              return [address];
            case "personal_sign":
              return "0xsigned";
            case "eth_sendTransaction":
              return "0xdeadbeef";
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            default:
              return null;
          }
        },
        requestPermissionToken: async () => ({ success: true }),
      };
    },
    [walletAddress],
  );
});

test("connects the wallet and shows the balance shell", async ({ page }) => {
  await page.route("**/api/auth/challenge", async (route) => {
    await route.fulfill({
      json: { message: "challenge-message" },
    });
  });

  await page.route("**/api/auth/verify", async (route) => {
    await route.fulfill({
      json: { success: true, address: walletAddress },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /connect wallet/i }).click();

  await expect(page.getByText(/0x1111/i)).toBeVisible();
});

test("sends a balance question through the chat panel", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      json: {
        message: "Your Sepolia wallet currently holds 0.01 ETH.",
        walletContext: {
          address: walletAddress,
          chainId: 11155111,
          chainName: "Sepolia",
          nativeBalanceWei: "10000000000000000",
          nativeBalanceEth: "0.01",
          tokenBalances: [],
      swapAvailable: true,
          activePermission: null,
          recentActions: [],
        },
        pendingAction: null,
      },
    });
  });

  await page.goto("/");
  await page.getByPlaceholder(/ask for balance/i).fill("What is my balance?");
  await page.getByRole("button", { name: /send message/i }).click();

  await expect(page.getByText(/currently holds 0.01 ETH/i)).toBeVisible();
});

test("grants permission and completes a transfer flow", async ({ page }) => {
  await page.route("**/api/auth/challenge", async (route) => {
    await route.fulfill({
      json: { message: "challenge-message" },
    });
  });

  await page.route("**/api/auth/verify", async (route) => {
    await route.fulfill({
      json: { success: true, address: walletAddress },
    });
  });

  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      json: {
        message: "I prepared the transfer. Grant a WaaP permission token to continue.",
        walletContext: {
          address: walletAddress,
          chainId: 11155111,
          chainName: "Sepolia",
          nativeBalanceWei: "10000000000000000",
          nativeBalanceEth: "0.01",
          tokenBalances: [],
      swapAvailable: true,
          activePermission: null,
          recentActions: [],
        },
        pendingAction: {
          id: "action-1",
          type: "native_transfer",
          status: "needs_approval",
          chainId: 11155111,
          toAddress: targetAddress,
          valueWei: "1000000000000000",
          valueEth: "0.001",
          estimatedValueUsd: "2.50",
          summary: "Send 0.001 ETH to target",
          reason: null,
          requiresPermission: true,
          canAutoExecute: false,
          txHash: null,
          error: null,
          permissionGrantId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });

  await page.route("**/api/permissions/grant", async (route) => {
    await route.fulfill({
      json: {
        walletContext: {
          address: walletAddress,
          chainId: 11155111,
          chainName: "Sepolia",
          nativeBalanceWei: "10000000000000000",
          nativeBalanceEth: "0.01",
          tokenBalances: [],
      swapAvailable: true,
          activePermission: {
            id: "grant-1",
            chainId: 11155111,
            actionType: "native_transfer",
            allowedAddresses: [targetAddress],
            maxAmountUsd: "10",
            expiresAt: new Date(Date.now() + 1800_000).toISOString(),
            createdAt: new Date().toISOString(),
            status: "active",
          },
          recentActions: [],
        },
      },
    });
  });

  await page.route("**/api/actions/action-1/confirm", async (route) => {
    await route.fulfill({
      json: {
        action: {
          id: "action-1",
          type: "native_transfer",
          status: "ready",
          chainId: 11155111,
          toAddress: targetAddress,
          valueWei: "1000000000000000",
          valueEth: "0.001",
          estimatedValueUsd: "2.50",
          summary: "Send 0.001 ETH to target",
          reason: null,
          requiresPermission: false,
          canAutoExecute: true,
          txHash: null,
          error: null,
          permissionGrantId: "grant-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        walletContext: {
          address: walletAddress,
          chainId: 11155111,
          chainName: "Sepolia",
          nativeBalanceWei: "10000000000000000",
          nativeBalanceEth: "0.01",
          tokenBalances: [],
      swapAvailable: true,
          activePermission: null,
          recentActions: [],
        },
      },
    });
  });

  await page.route("**/api/actions/action-1/complete", async (route) => {
    await route.fulfill({
      json: {
        action: {
          id: "action-1",
          type: "native_transfer",
          status: "completed",
          chainId: 11155111,
          toAddress: targetAddress,
          valueWei: "1000000000000000",
          valueEth: "0.001",
          estimatedValueUsd: "2.50",
          summary: "Send 0.001 ETH to target",
          reason: null,
          requiresPermission: false,
          canAutoExecute: true,
          txHash: "0xdeadbeef",
          error: null,
          permissionGrantId: "grant-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        walletContext: {
          address: walletAddress,
          chainId: 11155111,
          chainName: "Sepolia",
          nativeBalanceWei: "9000000000000000",
          nativeBalanceEth: "0.009",
          tokenBalances: [],
      swapAvailable: true,
          activePermission: null,
          recentActions: [],
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByPlaceholder(/ask for balance/i).fill(`Send 0.001 ETH to ${targetAddress}`);
  await page.getByRole("button", { name: /send message/i }).click();
  await page.getByRole("button", { name: /grant waap permission and execute/i }).click();

  await expect(page.getByText(/transaction hash/i)).toBeVisible();
});
