# WaaP Agent

WaaP Agent is a Next.js + Bun app for a wallet-native AI copilot.

It connects a real Human Wallet / WaaP wallet in the browser, keeps model orchestration on the server with OpenRouter, and lets the agent inspect assets, prepare actions, search the web, and execute wallet flows through bounded approvals.

## What It Does

- Connects a user-owned WaaP wallet in the browser
- Keeps the AI agent server-side with OpenRouter
- Reads Sepolia ETH, ERC-20 balances, and NFT inventory
- Prepares and executes native transfers
- Routes direct Uniswap v3 swaps on Sepolia without a swap API key
- Supports NFT inspection and NFT transfer preparation
- Uses Exa MCP for live web search and page reading
- Streams assistant replies and now shows tool activity live in the chat UI
- Stores sessions, chat history, permission windows, and pending actions in SQLite

## Stack

- Next.js 16.2.2
- Bun
- React 19
- TypeScript
- `@human.tech/waap-sdk`
- `@openrouter/agent`
- `@modelcontextprotocol/sdk`
- `viem`
- `better-sqlite3`
- `drizzle-orm`

## Current Scope

The app currently targets Ethereum Sepolia.

Supported today:

- WaaP wallet connection and restore
- ETH balance
- ERC-20 token balances
- NFT inventory
- native ETH transfer flows
- direct Uniswap swaps for the supported token set on Sepolia
- NFT transfer preparation and execution flows
- live web research through Exa MCP

Not in scope yet:

- mainnet
- bridges
- lending
- arbitrary contract calls
- gasless smart-account flows

## Local Setup

1. Install dependencies:

```bash
bun install
```

2. Create your env file:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

3. Fill at least:

```env
OPENROUTER_API_KEY=your_openrouter_key
```

4. Start the app:

```bash
bun run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Server:

- `OPENROUTER_API_KEY`: required for the real model
- `OPENROUTER_MODEL`: optional, defaults to `openai/gpt-4.1-mini`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `OPENROUTER_TIMEOUT_MS`
- `EXA_MCP_URL`: defaults to `https://mcp.exa.ai/mcp`
- `EXA_API_KEY`: optional, only useful for higher Exa limits
- `BLOCKSCOUT_API_URL`
- `DATABASE_PATH`
- `SEPOLIA_RPC_URL`
- `MAX_NATIVE_TRANSFER_ETH`
- `MAX_SWAP_USD`
- `MAX_SWAP_SLIPPAGE_BPS`
- `ETH_USD_ESTIMATE`

Client:

- `NEXT_PUBLIC_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_WAAP_PROJECT_NAME`
- `NEXT_PUBLIC_WAAP_PROJECT_ID`
- `NEXT_PUBLIC_WAAP_REFERRAL_CODE`
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`

## OpenRouter

The OpenRouter client is centralized in [src/server/services/openrouter-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\openrouter-service.ts).

If `OPENROUTER_API_KEY` is missing, the app falls back to a local assistant path for a smaller set of wallet actions, but the full agent experience requires OpenRouter.

## Exa MCP

Web search is wired through Exa MCP in [src/server/services/exa-mcp-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\exa-mcp-service.ts).

This project uses the remote MCP endpoint:

- `https://mcp.exa.ai/mcp`

An Exa API key is optional here. The no-key path works, with lower free-plan limits.

## Wallet + Action Architecture

- WaaP wallet connection happens in the browser
- AI orchestration runs on the server
- risky wallet actions become pending actions first
- local policy checks decide whether the action is allowed
- WaaP permission windows gate autonomous execution

Main files:

- [src/components/app-shell.tsx](C:\Users\crist\Desktop\WaaPAgent\src\components\app-shell.tsx)
- [src/server/services/agent-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\agent-service.ts)
- [src/server/services/waap-wallet-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\waap-wallet-service.ts)
- [src/server/services/policy-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\policy-service.ts)

## Swaps

Swaps do not depend on the Uniswap Trading API.

The app quotes and routes directly against Uniswap contracts on Sepolia in [src/server/services/uniswap-trade-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\uniswap-trade-service.ts).

That means:

- no Uniswap API key
- direct routing
- local approval handling for ERC-20 input when needed

## NFT Support

NFT inventory is fetched separately from the fast wallet context so the main app shell stays responsive.

Relevant files:

- [src/server/services/nft-asset-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\nft-asset-service.ts)
- [src/app/api/wallet/nfts/route.ts](C:\Users\crist\Desktop\WaaPAgent\src\app\api\wallet\nfts\route.ts)
- [src/components/wallet-panel.tsx](C:\Users\crist\Desktop\WaaPAgent\src\components\wallet-panel.tsx)

NFT artwork is proxied locally for smaller, cached thumbnails via [src/app/api/nft-image/route.ts](C:\Users\crist\Desktop\WaaPAgent\src\app\api\nft-image\route.ts).

## Live Tool Transparency

The assistant now streams tool activity into the chat UI while it thinks.

That flow lives across:

- [src/app/api/chat/route.ts](C:\Users\crist\Desktop\WaaPAgent\src\app\api\chat\route.ts)
- [src/server/services/agent-service.ts](C:\Users\crist\Desktop\WaaPAgent\src\server\services\agent-service.ts)
- [src/components/chat-panel.tsx](C:\Users\crist\Desktop\WaaPAgent\src\components\chat-panel.tsx)

## Scripts

```bash
bun run dev
bun run build
bun run start
bun run lint
bun run test
bun run test:e2e
bun run db:generate
```

## Notes

- This repo is optimized around WaaP, not MetaMask-first flows
- The app currently assumes Sepolia for wallet actions
- Some wallet and approval flows depend on the exact WaaP project configuration in your env
- Exa MCP and OpenRouter both require network access from the server runtime
