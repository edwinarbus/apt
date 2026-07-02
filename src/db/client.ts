import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "apt.db");

/**
 * Open (and migrate) a database. Both the Next.js app and CLI scripts use
 * this; tests pass ":memory:" for isolation. Migrations live in ./drizzle and
 * are generated with `npm run db:generate`.
 */
export function createDb(dbPath?: string): Db {
  const resolved = dbPath ?? process.env.APT_DB_PATH ?? DEFAULT_DB_PATH;
  if (resolved !== ":memory:") {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return db;
}

let singleton: Db | null = null;

/** Shared connection for the Next.js server process. */
export function getDb(): Db {
  singleton ??= createDb();
  return singleton;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
