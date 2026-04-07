"use client";

import type { InitWaaPOptions, WaaPProvider } from "@human.tech/waap-sdk";

import {
  DEFAULT_RPC_URL,
  SEPOLIA_CHAIN_ID,
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

    initWaaP(options);
    window.__waapInitialized = true;
  }

  if (!window.waap) {
    throw new Error("Failed to initialize WaaP.");
  }

  return window.waap;
}

export async function switchToSepolia(waap: WaaPProvider) {
  try {
    await waap.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
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
