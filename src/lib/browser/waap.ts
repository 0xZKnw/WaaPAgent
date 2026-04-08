"use client";

import type {
  InitWaaPOptions,
  WaaPProvider,
} from "@human.tech/waap-sdk";

import {
  DEFAULT_RPC_URL,
  SEPOLIA_CHAIN_NAME,
  SEPOLIA_HEX_CHAIN_ID,
} from "@/lib/constants";
import { publicEnv } from "@/lib/env";

declare global {
  interface Window {
    waap?: WaaPProvider;
    __waapInitialized?: boolean;
  }
}

const PROVIDER_INIT_TIMEOUT_MS = 2_000;
const ACCOUNT_RETRY_DELAYS_MS = [120, 280, 520, 900] as const;
type WaaPLoginMethod = "waap" | "human" | "injected" | "walletconnect" | null;

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isWaapManagedLoginMethod(loginMethod: WaaPLoginMethod) {
  return loginMethod === "waap" || loginMethod === "human";
}

async function waitForWaapProvider() {
  const startedAt = Date.now();

  while (!window.waap) {
    if (Date.now() - startedAt >= PROVIDER_INIT_TIMEOUT_MS) {
      break;
    }

    await delay(40);
  }

  return window.waap;
}

export async function getWaapAccounts(waap: WaaPProvider) {
  const accounts = (await waap.request({
    method: "eth_accounts",
  })) as string[];

  return accounts.filter(Boolean);
}

export async function requestWaapAccounts(
  waap: WaaPProvider,
  options: { interactive?: boolean; preferWaapLogin?: boolean } = {},
) {
  const { interactive = false, preferWaapLogin = false } = options;

  if (interactive) {
    const accounts = (await waap.request({
      method: "eth_requestAccounts",
    })) as string[];

    if (accounts[0]) {
      return accounts.filter(Boolean);
    }

    if (preferWaapLogin) {
      const loginMethod = await waap.login();

      if (loginMethod && !isWaapManagedLoginMethod(loginMethod)) {
        await waap.logout();
        throw new Error("Only Human Wallet sign-in is allowed in this app.");
      }

      const loginAccounts = await getWaapAccounts(waap);

      if (loginAccounts[0]) {
        return loginAccounts;
      }
    }
  }

  let accounts = await getWaapAccounts(waap);

  if (accounts[0]) {
    return accounts;
  }

  for (const delayMs of ACCOUNT_RETRY_DELAYS_MS) {
    await delay(delayMs);
    accounts = await getWaapAccounts(waap);

    if (accounts[0]) {
      return accounts;
    }
  }

  return accounts;
}

export async function ensureWaap() {
  if (typeof window === "undefined") {
    throw new Error("WaaP is only available in the browser.");
  }

  if (!window.__waapInitialized || !window.waap) {
    const { initWaaP } = await import("@human.tech/waap-sdk");
    const authenticationMethods = ["email", "social"] as Array<
      "email" | "social" | "wallet"
    >;

    if (publicEnv.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID) {
      authenticationMethods.push("wallet");
    }

    const options: InitWaaPOptions = {
      walletConnectProjectId: publicEnv.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
      referralCode: publicEnv.NEXT_PUBLIC_WAAP_REFERRAL_CODE,
      config: {
        authenticationMethods,
        styles: {
          darkMode: false,
        },
        showSecured: true,
      },
      project: {
        name: publicEnv.NEXT_PUBLIC_WAAP_PROJECT_NAME,
        projectId: publicEnv.NEXT_PUBLIC_WAAP_PROJECT_ID,
        entryTitle: "Connect your agent wallet",
      },
    };

    const provider = initWaaP(options);
    window.waap = provider;
    window.__waapInitialized = true;
  }

  const provider = window.waap ?? (await waitForWaapProvider());

  if (!provider) {
    throw new Error("Failed to initialize WaaP.");
  }

  window.waap = provider;

  return provider;
}

export async function switchToSepolia(waap: WaaPProvider) {
  try {
    await waap.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX_CHAIN_ID }],
    });
  } catch {
    await waap.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_HEX_CHAIN_ID,
          chainName: SEPOLIA_CHAIN_NAME,
          nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: [publicEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || DEFAULT_RPC_URL],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }
}
