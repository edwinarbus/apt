import "@/lib/load-env";
import { createDb, DEFAULT_DB_PATH } from "@/db/client";
import * as schema from "@/db/schema";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * One-time (or re-runnable) copy of every row from the local SQLite file into
 * the Turso-hosted production database. Both share the exact same schema, so
 * this is a table-by-table dump + bulk insert, done in dependency order so
 * foreign-key references always land after the rows they point to.
 *
 * Requires TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment — these
 * are deliberately commented out of .env.local so local dev doesn't
 * accidentally point at the remote db, so pass them inline instead:
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:copy-to-turso
 *
 * Safe to re-run: existing rows (by primary key) are left alone.
 */

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
  const tursoDb = await createDb(); // no explicit path -> picks up TURSO_DATABASE_URL

  for (const { name, table } of TABLES) {
    const rows = await localDb.select().from(table).all();
    if (rows.length === 0) {
      console.log(`${name}: 0 rows, skipping`);
      continue;
    }
    let copied = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await tursoDb.insert(table).values(batch).onConflictDoNothing().run();
      copied += batch.length;
    }
    console.log(`${name}: copied ${copied} row(s)`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
