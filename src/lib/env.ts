import { z } from "zod";

import {
  APP_NAME,
  DEFAULT_ETH_USD_ESTIMATE,
  DEFAULT_BLOCKSCOUT_API_URL,
  DEFAULT_MAX_NATIVE_TRANSFER_ETH,
  DEFAULT_MAX_SWAP_SLIPPAGE_BPS,
  DEFAULT_MAX_SWAP_USD,
  DEFAULT_RPC_URL,
} from "@/lib/constants";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  OPENROUTER_API_KEY: optionalNonEmptyString,
  OPENROUTER_MODEL: z.string().default("openai/gpt-4.1-mini"),
  OPENROUTER_HTTP_REFERER: z.string().url().default("http://localhost:3000"),
  OPENROUTER_APP_TITLE: z.string().default(APP_NAME),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  BLOCKSCOUT_API_URL: z.string().url().default(DEFAULT_BLOCKSCOUT_API_URL),
  DATABASE_PATH: z.string().default(".data/waap-agent.sqlite"),
  SEPOLIA_RPC_URL: z.string().url().default(DEFAULT_RPC_URL),
  MAX_NATIVE_TRANSFER_ETH: z.string().default(DEFAULT_MAX_NATIVE_TRANSFER_ETH),
  MAX_SWAP_USD: z.string().default(DEFAULT_MAX_SWAP_USD),
  MAX_SWAP_SLIPPAGE_BPS: z.string().default(DEFAULT_MAX_SWAP_SLIPPAGE_BPS),
  ETH_USD_ESTIMATE: z.string().default(DEFAULT_ETH_USD_ESTIMATE),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SEPOLIA_RPC_URL: z.string().url().default(DEFAULT_RPC_URL),
  NEXT_PUBLIC_WAAP_PROJECT_NAME: z.string().default(APP_NAME),
  NEXT_PUBLIC_WAAP_PROJECT_ID: optionalNonEmptyString,
  NEXT_PUBLIC_WAAP_REFERRAL_CODE: optionalNonEmptyString,
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: optionalNonEmptyString,
});

export const env = envSchema.parse({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_HTTP_REFERER: process.env.OPENROUTER_HTTP_REFERER,
  OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE,
  OPENROUTER_TIMEOUT_MS: process.env.OPENROUTER_TIMEOUT_MS,
  BLOCKSCOUT_API_URL: process.env.BLOCKSCOUT_API_URL,
  DATABASE_PATH: process.env.DATABASE_PATH,
  SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL,
  MAX_NATIVE_TRANSFER_ETH: process.env.MAX_NATIVE_TRANSFER_ETH,
  MAX_SWAP_USD: process.env.MAX_SWAP_USD,
  MAX_SWAP_SLIPPAGE_BPS: process.env.MAX_SWAP_SLIPPAGE_BPS,
  ETH_USD_ESTIMATE: process.env.ETH_USD_ESTIMATE,
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_WAAP_PROJECT_NAME: process.env.NEXT_PUBLIC_WAAP_PROJECT_NAME,
  NEXT_PUBLIC_WAAP_PROJECT_ID: process.env.NEXT_PUBLIC_WAAP_PROJECT_ID,
  NEXT_PUBLIC_WAAP_REFERRAL_CODE: process.env.NEXT_PUBLIC_WAAP_REFERRAL_CODE,
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
});
