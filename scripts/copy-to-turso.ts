import "@/lib/load-env";
import { getTableColumns, sql } from "drizzle-orm";
import { createDb, DEFAULT_DB_PATH } from "@/db/client";
import * as schema from "@/db/schema";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * One-time (or re-runnable) copy of every row from the local SQLite file into
 * the Turso-hosted production database. Both share the exact same schema, so
 * this is a table-by-table dump + bulk upsert, done in dependency order so
 * foreign-key references always land after the rows they point to.
 *
 * Requires TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment — these
 * are deliberately commented out of .env.local so local dev doesn't
 * accidentally point at the remote db, so pass them inline instead:
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:copy-to-turso
 *
 * Safe to re-run: on a primary-key conflict the existing row is UPDATED to
 * match local (so backfilled photos/enrichment/vision propagate, not just
 * brand-new rows). The one exception is user_listing_states: those saves and
 * dislikes are written directly on production by the live app, so a batch
 * sync must never clobber them — that table stays insert-only.
 */

const PRESERVE_ON_CONFLICT = new Set(["userListingStates"]);

const TABLES: Array<{ name: string; table: SQLiteTable }> = [
  { name: "sources", table: schema.sources },
  { name: "sourceRuns", table: schema.sourceRuns },
  { name: "listings", table: schema.listings },
  { name: "listingEvents", table: schema.listingEvents },
  { name: "userListingStates", table: schema.userListingStates },
  { name: "savedSearches", table: schema.savedSearches },
  { name: "geocodeCache", table: schema.geocodeCache },
  { name: "duplicateGroups", table: schema.duplicateGroups },
  { name: "priceHistory", table: schema.priceHistory },
  { name: "savedSearchMatches", table: schema.savedSearchMatches },
  { name: "digestRuns", table: schema.digestRuns },
  { name: "listingEnrichment", table: schema.listingEnrichment },
  { name: "listingVision", table: schema.listingVision },
];

const BATCH_SIZE = 50;

/** The single-column primary key of a table (every table here has one). */
function primaryKeyColumn(table: SQLiteTable) {
  const col = Object.values(getTableColumns(table)).find((c) => c.primary);
  if (!col) throw new Error("table has no single-column primary key");
  return col;
}

/** SET clause updating every non-PK column to the incoming (excluded) value. */
function upsertSet(table: SQLiteTable): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (col.primary) continue;
    set[key] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error(
      "TURSO_DATABASE_URL not set. Run with:\n" +
        "  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:copy-to-turso",
    );
    process.exit(1);
  }

  console.log(`Local:  ${process.env.APT_DB_PATH ?? DEFAULT_DB_PATH}`);
  console.log(`Turso:  ${process.env.TURSO_DATABASE_URL}\n`);

  const localDb = await createDb(DEFAULT_DB_PATH);
  // Force migrations on the destination so a fresh Turso DB gets the schema
  // (the app path skips migrate on Turso for cold-start speed).
  const tursoDb = await createDb(undefined, { migrate: true });

  for (const { name, table } of TABLES) {
    const rows = await localDb.select().from(table).all();
    if (rows.length === 0) {
      console.log(`${name}: 0 rows, skipping`);
      continue;
    }
    const update = !PRESERVE_ON_CONFLICT.has(name);
    let copied = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const stmt = tursoDb.insert(table).values(batch);
      await (update
        ? stmt.onConflictDoUpdate({ target: primaryKeyColumn(table), set: upsertSet(table) })
        : stmt.onConflictDoNothing()
      ).run();
      copied += batch.length;
    }
    console.log(`${name}: ${update ? "upserted" : "inserted"} ${copied} row(s)`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
