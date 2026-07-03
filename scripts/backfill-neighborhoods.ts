import { eq } from "drizzle-orm";
import { getDb, nowIso } from "@/db/client";
import { listings } from "@/db/schema";
import { neighborhoodForPoint } from "@/core/neighborhood-geo";

/**
 * Backfill neighborhoods from the authoritative polygon reverse-lookup.
 *
 * Two cases, both safe to re-run:
 *  - Any listing with coordinates but NO neighborhood → fill it in.
 *  - `rentalsinsf` listings → override, because that adapter used to prose-match
 *    a neighborhood from address-only posts that name-drop other areas (fixed
 *    in the adapter; this repairs rows ingested before the fix).
 *
 * Source-provided neighborhoods on every other source are left untouched — they
 * are often finer than the 37 planning polygons (Hayes Valley, NoPa, …).
 *
 *   npm run backfill:neighborhoods
 */

const OVERRIDE_SOURCES = new Set(["rentalsinsf"]);

function main() {
  const db = getDb();
  const rows = db.select().from(listings).all();
  let filled = 0;
  let overridden = 0;
  let outsideSf = 0;

  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) continue;
    const shouldOverride = OVERRIDE_SOURCES.has(row.sourceId);
    if (row.neighborhood && !shouldOverride) continue;

    const hood = neighborhoodForPoint(row.longitude, row.latitude);
    if (!hood) {
      if (!row.neighborhood) outsideSf++;
      continue;
    }
    if (hood === row.neighborhood) continue;

    db.update(listings)
      .set({ neighborhood: hood, updatedAt: nowIso() })
      .where(eq(listings.id, row.id))
      .run();
    if (row.neighborhood) overridden++;
    else filled++;
  }

  console.log(
    `neighborhoods: ${filled} filled, ${overridden} overridden, ` +
      `${outsideSf} left blank (point outside SF polygons)`,
  );
}

main();
