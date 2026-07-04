import "@/lib/load-env";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";

/**
 * Backfill: null out addressRaw for listings where it's actually just
 * Craigslist's generic "(google map)" link label, scraped before the
 * adapter learned to recognize and skip it (see src/adapters/craigslist.ts).
 * Idempotent: only touches rows matching that exact junk pattern.
 *
 *   npm run backfill:junk-addresses
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run backfill:junk-addresses   (production)
 */

async function main() {
  const db = await getDb();
  const rows = await db
    .select({ id: listings.id, addressRaw: listings.addressRaw })
    .from(listings)
    .where(sql`lower(${listings.addressRaw}) LIKE '%google map%'`)
    .all();

  let updated = 0;
  for (const row of rows) {
    await db.update(listings).set({ addressRaw: null }).where(eq(listings.id, row.id)).run();
    updated++;
  }

  console.log(`Cleared junk addressRaw on ${updated} listing(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
