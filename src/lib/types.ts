export type ChatRole = "user" | "assistant";
export type WalletActionType = "native_transfer" | "token_swap" | "nft_transfer";
export type AgentToolTraceStatus = "running" | "completed" | "failed";

export interface ChatRequest {
  message: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export type PermissionGrantStatus = "active" | "expired" | "revoked";

export interface PermissionGrant {
  id: string;
  chainId: number;
  actionType: WalletActionType;
  allowedAddresses: string[];
  maxAmountUsd: string;
  expiresAt: string;
  createdAt: string;
  status: PermissionGrantStatus;
}

export interface PreparedOnchainTransaction {
  to: string;
  data?: string;
  value?: string;
  from?: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export interface WalletTokenBalance {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balanceDisplay: string;
  type: string;
  iconUrl?: string | null;
  usdRate?: string | null;
  usdValue?: string | null;
}

export interface SupportedSwapToken {
  chainId: number;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isNative?: boolean;
}

export interface WalletNftAsset {
  contractAddress: string;
  tokenId: string;
  tokenType: "ERC-721" | "ERC-1155" | string;
  collectionName: string;
  collectionSymbol: string;
  name: string;
  description?: string | null;
  balance: string;
  isUnique: boolean;
  imageUrl?: string | null;
  animationUrl?: string | null;
  externalUrl?: string | null;
}

export interface SwapActionMetadata {
  kind: "token_swap";
  protocol: "uniswap";
  tokenInSymbol: string;
  tokenInAddress: string;
  tokenInDecimals: number;
  tokenOutSymbol: string;
  tokenOutAddress: string;
  tokenOutDecimals: number;
  amountInRaw: string;
  amountInDisplay: string;
  quotedAmountOutRaw: string;
  quotedAmountOutDisplay: string;
  quoteId: string | null;
  routeString: string | null;
  approvalTx: PreparedOnchainTransaction | null;
  swapTx: PreparedOnchainTransaction;
}

export interface NftTransferActionMetadata {
  kind: "nft_transfer";
  tokenType: "ERC-721" | "ERC-1155";
  contractAddress: string;
  tokenId: string;
  quantity: string;
  collectionName: string;
  collectionSymbol: string;
  assetName: string;
  imageUrl?: string | null;
  transferTx: PreparedOnchainTransaction;
}

export type WalletActionMetadata = SwapActionMetadata | NftTransferActionMetadata;

export type PendingWalletActionStatus =
  | "needs_approval"
  | "ready"
  | "completed"
  | "failed";

export interface PendingWalletAction {
  id: string;
  type: WalletActionType;
  status: PendingWalletActionStatus;
  chainId: number;
  toAddress: string;
  valueWei: string;
  valueEth: string;
  estimatedValueUsd: string;
  summary: string;
  reason?: string | null;
  requiresPermission: boolean;
  canAutoExecute: boolean;
  txHash?: string | null;
  error?: string | null;
  permissionGrantId?: string | null;
  metadata?: WalletActionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletContext {
  address: string;
  chainId: number;
  chainName: string;
  nativeBalanceWei: string;
  nativeBalanceEth: string;
  tokenBalances: WalletTokenBalance[];
  nftAssets: WalletNftAsset[];
  swapAvailable: boolean;
  supportedSwapTokens: SupportedSwapToken[];
  activePermission: PermissionGrant | null;
  recentActions: PendingWalletAction[];
}

export interface AgentToolTraceItem {
  id: string;
  name: string;
  label: string;
  detail?: string | null;
  status: AgentToolTraceStatus;
}

export interface ChatResponse {
  message: string;
  walletContext: WalletContext;
  pendingAction: PendingWalletAction | null;
  toolTrace?: AgentToolTraceItem[];
}

export interface WalletActionResult {
  actionId: string;
  status: PendingWalletActionStatus;
  txHash?: string | null;
  error?: string | null;
}

export interface PermissionGrantInput {
  actionId?: string;
  chainId: number;
  actionType: WalletActionType;
  allowedAddresses: string[];
  maxAmountUsd: string;
  requestedExpirySeconds: number;
}
