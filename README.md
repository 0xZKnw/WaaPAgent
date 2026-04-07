# WaaP Agent

Next.js + Bun app for a wallet-native AI agent using:

- `@human.tech/waap-sdk` for the user wallet flow
- `@openrouter/agent` for server-side model orchestration
- direct Uniswap v3 contracts on Sepolia for swaps
- `better-sqlite3` + `drizzle-orm` for local persistence

## Local setup

1. Fill in `OPENROUTER_API_KEY` in `.env.local`
2. Optionally change `OPENROUTER_MODEL`
3. Start the app:

```bash
bun run dev
```

## OpenRouter config

The project is already wired for OpenRouter through:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `OPENROUTER_TIMEOUT_MS`

Client creation is centralized in [src/server/services/openrouter-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\openrouter-service.ts).

Until `OPENROUTER_API_KEY` is filled, the app falls back to a local rules-based assistant for balance, transfers, and ETH/USDC swap preparation on Sepolia.

## Swap routing

The app no longer depends on the Uniswap Trading API or any swap API key.

For Sepolia swaps it now:

- quotes directly against `QuoterV2`
- routes through `SwapRouter02`
- supports exact-input `ETH <-> USDC`
- uses a local approval flow for ERC-20 input when needed

## Useful commands

```bash
bun run dev
bun run build
bun run lint
bun run test
bun run test:e2e
```
