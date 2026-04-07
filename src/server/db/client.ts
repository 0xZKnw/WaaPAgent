import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { env } from "@/lib/env";
import * as schema from "@/server/db/schema";

const globalForDb = globalThis as typeof globalThis & {
  __waapAgentSqlite?: Database.Database;
  __waapAgentDb?: ReturnType<typeof drizzle>;
};

function resolveDatabasePath() {
  if (env.DATABASE_PATH === ":memory:") {
    return env.DATABASE_PATH;
  }

  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  return env.DATABASE_PATH;
}

export function getSqlite() {
  if (!globalForDb.__waapAgentSqlite) {
    globalForDb.__waapAgentSqlite = new Database(resolveDatabasePath());
    globalForDb.__waapAgentSqlite.pragma("journal_mode = WAL");
  }

  return globalForDb.__waapAgentSqlite;
}

export function getDb() {
  if (!globalForDb.__waapAgentDb) {
    globalForDb.__waapAgentDb = drizzle(getSqlite(), { schema });
  }

  return globalForDb.__waapAgentDb;
}
