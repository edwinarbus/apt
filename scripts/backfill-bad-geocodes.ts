import "@/lib/load-env";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";
import { isWithinSf, neighborhoodFallback } from "@/core/geocode";
import { neighborhoodForPoint } from "@/core/neighborhood-geo";

/**
 * Backfill: fix listings whose stored lat/lng land outside San Francisco —
 * a bad or ambiguous geocode (a bare cross-street with no house number, a
 * stale cache entry from before isWithinSf existed) that used to be trusted
 * and plotted wherever it landed, sometimes well outside the city. Each is
 * either moved to its neighborhood's centroid (if known) or, failing that,
 * left uncoordinated — it still shows up in the results list, just without a
 * map pin, rather than a wrong one.
 *
 *   npm run backfill:bad-geocodes
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run backfill:bad-geocodes   (production)
 */

async function main() {
  const db = await getDb();
  const rows = await db
    .select({
      id: listings.id,
      latitude: listings.latitude,
      longitude: listings.longitude,
      neighborhood: listings.neighborhood,
    })
    .from(listings)
    .where(
      and(isNotNull(listings.latitude), isNotNull(listings.longitude)),
    )
    .all();

  const bad = rows.filter((r) => !isWithinSf(r.latitude!, r.longitude!));
  console.log(`Found ${bad.length} listing(s) geocoded outside San Francisco.`);

  let toNeighborhood = 0;
  let cleared = 0;
  for (const row of bad) {
    const fallback = neighborhoodFallback(row.neighborhood);
    if (fallback?.latitude != null && fallback.longitude != null) {
      await db
        .update(listings)
        .set({
          latitude: fallback.latitude,
          longitude: fallback.longitude,
          geocodePrecision: fallback.precision,
        })
        .where(eq(listings.id, row.id))
        .run();
      toNeighborhood++;
      console.log(`  ${row.id}: moved to ${row.neighborhood} centroid`);
    } else {
      // No usable neighborhood on file either — clear coordinates entirely
      // rather than guess; also clear a neighborhood that was itself
      // (mis)derived from the bad point via the reverse lookup.
      const derivedFromBadPoint =
        !row.neighborhood ? null : neighborhoodForPoint(row.longitude!, row.latitude!);
      await db
        .update(listings)
        .set({
          latitude: null,
          longitude: null,
          geocodePrecision: "unknown",
          ...(derivedFromBadPoint === row.neighborhood ? { neighborhood: null } : {}),
        })
        .where(eq(listings.id, row.id))
        .run();
      cleared++;
      console.log(`  ${row.id}: cleared (no neighborhood to fall back to)`);
    }
  }

  console.log(
    `\nDone: ${toNeighborhood} moved to a neighborhood centroid, ${cleared} cleared.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
