import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { createDb, DEFAULT_DB_PATH, newId, type Db } from "@/db/client";
import { listingEvents, listings, priceHistory, sources } from "@/db/schema";
import { canonicalizeListingUrl } from "@/core/urls";
import { formatSummaryLine, runSource, type RunSummary } from "@/ingest/runner";

/**
 * Backfill: fetch ALL currently available listings from working enabled
 * sources, with a raised detail-page budget so detail backlogs converge.
 * Safe to re-run: upserts are idempotent (firstSeenAt and price history are
 * preserved; unchanged listings produce no new events or history rows).
 *
 *   npm run listings:backfill                          all enabled sources
 *   npm run listings:backfill -- --source craigslist_sf
 *   npm run listings:backfill -- --no-stale-updates    never touch missing status
 *   npm run listings:backfill -- --dry-run             run against a throwaway DB copy
 *   npm run listings:backfill -- --max-detail 100      cap detail pages per source
 *   npm run listings:backfill -- --no-geocode
 *
 * Dry-run copies the database file and runs the complete pipeline against the
 * copy, so the printed numbers are exactly what a real run would do — then
 * the copy is deleted.
 */

const DEFAULT_BACKFILL_DETAIL_BUDGET = 400;

/**
 * One-time maintenance: reconstruct price history for listings created before
 * the price_history table existed, using the real observations recorded in
 * listing_events — a baseline at firstSeenAt (the earliest known price) plus
 * one row per historical price_change event. Idempotent: listings that
 * already have any history rows are left alone.
 */
function reconstructPriceHistory(db: Db): number {
  const rows = db.select().from(listings).all();
  let created = 0;
  for (const row of rows) {
    const existing = db
      .select({ id: priceHistory.id })
      .from(priceHistory)
      .where(eq(priceHistory.listingId, row.id))
      .limit(1)
      .all();
    if (existing.length > 0) continue;

    const changes = db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.listingId, row.id))
      .orderBy(asc(listingEvents.createdAt))
      .all()
      .filter((e) => e.eventType === "price_change" && e.oldValue && e.newValue);

    const baselinePrice = changes.length > 0 ? Number(changes[0].oldValue) : row.priceMonthly;
    db.insert(priceHistory)
      .values({
        id: newId("prc"),
        listingId: row.id,
        sourceRunId: null,
        observedAt: row.firstSeenAt,
        // raw text is only trustworthy for the current price
        priceRaw: changes.length === 0 ? row.priceRaw : null,
        priceMonthly: Number.isFinite(baselinePrice) ? baselinePrice : null,
        priceEffectiveMonthly: changes.length === 0 ? row.priceEffectiveMonthly : null,
        concessionsRaw: changes.length === 0 ? row.concessionsRaw : null,
        depositRaw: null,
      })
      .run();
    created++;
    for (const change of changes) {
      db.insert(priceHistory)
        .values({
          id: newId("prc"),
          listingId: row.id,
          sourceRunId: change.sourceRunId,
          observedAt: change.createdAt,
          priceRaw: null,
          priceMonthly: Number(change.newValue),
          priceEffectiveMonthly: null,
          concessionsRaw: null,
          depositRaw: null,
        })
        .run();
      created++;
    }
  }
  return created;
}

/** One-time maintenance: fill canonicalUrl for rows created before phase two. */
function backfillCanonicalUrls(db: Db): number {
  const rows = db
    .select({ id: listings.id, originalUrl: listings.originalUrl })
    .from(listings)
    .where(isNull(listings.canonicalUrl))
    .all();
  let updated = 0;
  for (const row of rows) {
    const canonical = canonicalizeListingUrl(row.originalUrl);
    if (canonical) {
      db.update(listings)
        .set({ canonicalUrl: canonical })
        .where(eq(listings.id, row.id))
        .run();
      updated++;
    }
  }
  return updated;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noStale = args.includes("--no-stale-updates");
  const noGeocode = args.includes("--no-geocode");
  const sourceIdx = args.indexOf("--source");
  const sourceId = sourceIdx >= 0 ? args[sourceIdx + 1] : null;
  const maxDetailIdx = args.indexOf("--max-detail");
  const maxDetail =
    maxDetailIdx >= 0 ? Number(args[maxDetailIdx + 1]) : DEFAULT_BACKFILL_DETAIL_BUDGET;

  let dbPath = process.env.APT_DB_PATH ?? DEFAULT_DB_PATH;
  let cleanup: (() => void) | null = null;

  if (dryRun) {
    // Flush WAL into the main file, then copy it; the run happens on the copy.
    const liveDb = createDb(dbPath);
    liveDb.run(sql`PRAGMA wal_checkpoint(TRUNCATE);`);
    const copyPath = path.join(
      os.tmpdir(),
      `apt-backfill-dryrun-${Date.now()}.db`,
    );
    fs.copyFileSync(dbPath, copyPath);
    dbPath = copyPath;
    cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(copyPath + suffix, { force: true });
      }
    };
    console.log("DRY RUN — operating on a throwaway copy; no changes will be saved.\n");
  }

  const db = createDb(dbPath);
  const log = (m: string) => console.log(`  ${m}`);

  const canonicalized = backfillCanonicalUrls(db);
  if (canonicalized > 0) {
    console.log(`Maintenance: populated canonicalUrl on ${canonicalized} existing listings.`);
  }
  const reconstructed = reconstructPriceHistory(db);
  if (reconstructed > 0) {
    console.log(
      `Maintenance: reconstructed ${reconstructed} price-history rows from recorded events.`,
    );
  }
  if (args.includes("--maintenance-only")) {
    console.log("\nMaintenance complete (--maintenance-only; no fetching).");
    cleanup?.();
    return;
  }

  const all = db.select().from(sources).all();
  const targets = sourceId
    ? all.filter((s) => s.id === sourceId)
    : all.filter((s) => s.enabled);
  if (sourceId && targets.length === 0) {
    console.error(`unknown source: ${sourceId}`);
    process.exit(1);
  }

  const summaries: RunSummary[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const s of all) {
    if (!targets.some((t) => t.id === s.id)) {
      if (!sourceId) skipped.push({ id: s.id, reason: "disabled/reference source" });
      continue;
    }
    console.log(`Backfilling ${s.id}…`);
    summaries.push(
      await runSource(db, s.id, {
        force: sourceId != null,
        geocode: !noGeocode,
        staleUpdates: !noStale,
        detailBudgetOverride: maxDetail,
        log,
      }),
    );
  }

  console.log(`\nBackfill complete${dryRun ? " (dry run — nothing saved)" : ""}:\n`);
  for (const s of summaries) console.log(formatSummaryLine(s));
  if (skipped.length > 0) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`- ${s.id}: ${s.reason}`);
  }

  cleanup?.();

  const failed = summaries.filter((s) => s.status === "failed").length;
  if (summaries.length > 0 && failed === summaries.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
