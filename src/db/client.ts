import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "apt.db");

/**
 * Open (and migrate) a database. Both the Next.js app and CLI scripts use
 * this; tests pass ":memory:" for isolation. Migrations live in ./drizzle and
 * are generated with `npm run db:generate`.
 *
 * One driver (libSQL) for every environment: local dev/tests/CLI scripts talk
 * to a plain SQLite file via a `file:` URL (no Turso account needed), while
 * production talks to a Turso-hosted database over the network. Vercel
 * Functions have a read-only filesystem outside /tmp, so a local file can't
 * work there — TURSO_DATABASE_URL/TURSO_AUTH_TOKEN switch to the remote path.
 */
export async function createDb(
  dbPath?: string,
  opts?: { migrate?: boolean },
): Promise<Db> {
  const explicit = dbPath ?? process.env.APT_DB_PATH;
  const tursoUrl = !explicit ? process.env.TURSO_DATABASE_URL : undefined;

  let url: string;
  let authToken: string | undefined;
  if (tursoUrl) {
    url = tursoUrl;
    authToken = process.env.TURSO_AUTH_TOKEN;
  } else {
    let resolved = explicit ?? DEFAULT_DB_PATH;
    if (resolved === ":memory:") {
      // libsql's local client reconnects internally after every db.transaction()
      // call (it nulls its cached connection so the next statement lazily reopens
      // one) — for a real file that's a no-op, but SQLite's anonymous ":memory:"
      // has no data to reopen, so it would silently start over on a fresh, empty
      // database mid-test. A real (if throwaway) temp file sidesteps the whole
      // class of reconnect/shared-cache quirks and still gives each test its own
      // isolated, disposable database.
      resolved = path.join(os.tmpdir(), `apt-test-${crypto.randomUUID()}.db`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    url = `file:${resolved}`;
  }

  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  // Local/test/CLI databases auto-migrate so the schema is always ready. The
  // remote Turso (production) DB is NOT migrated here: doing so on every cold
  // serverless start adds several cross-network round-trips before the first
  // query. Production schema is applied deliberately at deploy time via
  // `npm run db:migrate:prod`. Pass { migrate: true } to force it (e.g. when
  // seeding a fresh Turso database).
  const shouldMigrate = opts?.migrate ?? !tursoUrl;
  if (shouldMigrate) {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  }
  return db;
}

let singleton: Promise<Db> | null = null;

/** Shared connection for the Next.js server process. */
export function getDb(): Promise<Db> {
  singleton ??= createDb();
  return singleton;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
