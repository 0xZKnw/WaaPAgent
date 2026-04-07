export type ChatRole = "user" | "assistant";
export type WalletActionType = "native_transfer" | "token_swap";

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
  metadata?: SwapActionMetadata | null;
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
  swapAvailable: boolean;
  activePermission: PermissionGrant | null;
  recentActions: PendingWalletAction[];
}

export interface ChatResponse {
  message: string;
  walletContext: WalletContext;
  pendingAction: PendingWalletAction | null;
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
