import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  address: text("address").notNull(),
  nonce: text("nonce").notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  address: text("address").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  metadata: text("metadata"),
});

export const permissionGrants = sqliteTable("permission_grants", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  chainId: integer("chain_id").notNull(),
  actionType: text("action_type").notNull(),
  allowedAddresses: text("allowed_addresses").notNull(),
  maxAmountUsd: text("max_amount_usd").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  status: text("status").notNull(),
});

export const pendingActions = sqliteTable("pending_actions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  permissionGrantId: text("permission_grant_id"),
  type: text("type").notNull(),
  status: text("status").notNull(),
  chainId: integer("chain_id").notNull(),
  toAddress: text("to_address").notNull(),
  valueWei: text("value_wei").notNull(),
  estimatedValueUsd: text("estimated_value_usd").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason"),
  requiresPermission: integer("requires_permission", {
    mode: "boolean",
  }).notNull(),
  canAutoExecute: integer("can_auto_execute", {
    mode: "boolean",
  }).notNull(),
  txHash: text("tx_hash"),
  error: text("error"),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
