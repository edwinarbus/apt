import { eq } from "drizzle-orm";
import { createDb, newId, nowIso } from "@/db/client";
import { listings, savedSearches, sources, userListingStates } from "@/db/schema";
import { SOURCE_SEEDS } from "@/config/sources";
import { formatSummaryLine, runSource } from "@/ingest/runner";
import type { SavedSearchCriteria } from "@/core/match";

/**
 * Seed realistic mock data by running the mock adapter through the REAL
 * ingestion pipeline four times:
 *   run 1 (phase 1): initial 28 listings
 *   runs 2-4 (phase 2): two listings disappear (missing_once ->
 *   missing_multiple_runs -> likely_unavailable), three prices change,
 *   two new listings appear
 * then applies example user statuses and one example saved search.
 */

async function main() {
  const db = createDb();

  // Make sure the registry exists (idempotent).
  const now = nowIso();
  for (const seed of SOURCE_SEEDS) {
    const existing = db.select().from(sources).where(eq(sources.id, seed.id)).get();
    if (!existing) {
      db.insert(sources).values({ ...seed, createdAt: now, updatedAt: now }).run();
    }
  }

  console.log("Running mock ingestion (phase 1: initial inventory)…");
  process.env.APT_MOCK_PHASE = "1";
  console.log(formatSummaryLine(await runSource(db, "mock_sf", { force: true })));

  process.env.APT_MOCK_PHASE = "2";
  for (let i = 2; i <= 4; i++) {
    console.log(`\nRunning mock ingestion (phase 2, run ${i}: drops + price changes)…`);
    console.log(formatSummaryLine(await runSource(db, "mock_sf", { force: true })));
  }

  // Example user statuses on well-known mock listings.
  const statusBySourceListingId: Record<string, { status: string; note?: string }> = {
    "mock-001": { status: "saved", note: "Top pick — great block, call about parking" },
    "mock-026": { status: "saved" },
    "mock-004": { status: "contacted", note: "Emailed leasing 6/28, waiting on tour times" },
    "mock-013": { status: "toured", note: "Toured 6/25 — sunny but loud corner" },
    "mock-023": { status: "applied" },
    "mock-014": { status: "maybe" },
    "mock-020": { status: "not_a_fit", note: "No laundry" },
    "mock-015": { status: "hidden" },
    "mock-011": { status: "suspicious", note: "Wire-transfer language; do not contact" },
  };
  const ts = nowIso();
  let statuses = 0;
  for (const [sourceListingId, s] of Object.entries(statusBySourceListingId)) {
    const row = db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.sourceListingId, sourceListingId))
      .get();
    if (!row) continue;
    db.insert(userListingStates)
      .values({ listingId: row.id, status: s.status, note: s.note ?? null, updatedAt: ts })
      .onConflictDoUpdate({
        target: userListingStates.listingId,
        set: { status: s.status, note: s.note ?? null, updatedAt: ts },
      })
      .run();
    statuses++;
  }
  console.log(`\nApplied ${statuses} example user statuses.`);

  // Example saved search matching the long-term product direction.
  const criteria: SavedSearchCriteria = {
    maxPrice: 3200,
    minBedrooms: 0,
    maxBedrooms: 1,
    minSquareFeet: 450,
    neighborhoods: ["Lower Haight", "Duboce Triangle", "Castro", "Hayes Valley"],
    requireDogsAllowed: true,
    laundry: ["in_unit", "in_building"],
    availableBy: new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  };
  const existing = db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.name, "1BR/large studio near Duboce, dog-friendly"))
    .get();
  if (!existing) {
    db.insert(savedSearches)
      .values({
        id: newId("srch"),
        name: "1BR/large studio near Duboce, dog-friendly",
        criteria,
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    console.log("Created example saved search.");
  }

  console.log("\nMock data ready. Start the app with `npm run dev`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
