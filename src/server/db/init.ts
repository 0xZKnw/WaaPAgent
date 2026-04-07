import { getSqlite } from "@/server/db/client";

const statements = [
  `create table if not exists auth_challenges (
    id text primary key,
    address text not null,
    nonce text not null,
    message text not null,
    created_at integer not null,
    expires_at integer not null,
    consumed_at integer
  )`,
  `create table if not exists sessions (
    id text primary key,
    session_token text not null unique,
    address text not null,
    created_at integer not null,
    expires_at integer not null,
    last_seen_at integer not null
  )`,
  `create table if not exists chat_messages (
    id text primary key,
    session_id text not null,
    role text not null,
    content text not null,
    created_at integer not null,
    metadata text
  )`,
  `create table if not exists permission_grants (
    id text primary key,
    session_id text not null,
    chain_id integer not null,
    action_type text not null,
    allowed_addresses text not null,
    max_amount_usd text not null,
    expires_at integer not null,
    created_at integer not null,
    status text not null
  )`,
  `create table if not exists pending_actions (
    id text primary key,
    session_id text not null,
    permission_grant_id text,
    type text not null,
    status text not null,
    chain_id integer not null,
    to_address text not null,
    value_wei text not null,
    estimated_value_usd text not null,
    summary text not null,
    reason text,
    requires_permission integer not null,
    can_auto_execute integer not null,
    tx_hash text,
    error text,
    created_at integer not null,
    updated_at integer not null
  )`,
];

let initialized = false;

function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string,
) {
  const sqlite = getSqlite();
  const rows = sqlite.prepare(`pragma table_info(${tableName})`).all() as Array<{
    name: string;
  }>;

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  sqlite.exec(`alter table ${tableName} add column ${columnName} ${definition}`);
}

export function ensureDatabase() {
  if (initialized) {
    return;
  }

  const sqlite = getSqlite();

  for (const statement of statements) {
    sqlite.exec(statement);
  }

  ensureColumn("pending_actions", "metadata", "text");

  initialized = true;
}
