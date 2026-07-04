import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  listingEvents,
  listings,
  sourceRuns,
  sources,
  userListingStates,
} from "@/db/schema";
import { computeBadges } from "@/lib/badges";
import type { ListingSummary, ListingsResponse, PriceChangeInfo } from "@/lib/api-types";
import type { RunStatus } from "@/core/types";

export const dynamic = "force-dynamic";

// Only the columns the list card + badges need. Explicitly avoids the heavy
// per-row blobs (description, rawDescription, rawPayload, amenities, etc.) so
// Turso ships a fraction of the bytes for ~800 rows — those only matter on the
// single-listing detail route.
const listingCols = {
  id: listings.id,
  sourceId: listings.sourceId,
  sourceSystem: listings.sourceSystem,
  originalUrl: listings.originalUrl,
  title: listings.title,
  propertyName: listings.propertyName,
  neighborhood: listings.neighborhood,
  sourceNeighborhoodRaw: listings.sourceNeighborhoodRaw,
  addressRaw: listings.addressRaw,
  unitNumberPublic: listings.unitNumberPublic,
  latitude: listings.latitude,
  longitude: listings.longitude,
  geocodePrecision: listings.geocodePrecision,
  priceMonthly: listings.priceMonthly,
  priceEffectiveMonthly: listings.priceEffectiveMonthly,
  concessionsRaw: listings.concessionsRaw,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  squareFeet: listings.squareFeet,
  pricePerSquareFoot: listings.pricePerSquareFoot,
  primaryPhotoUrl: listings.primaryPhotoUrl,
  photos: listings.photos,
  catsAllowed: listings.catsAllowed,
  dogsAllowed: listings.dogsAllowed,
  laundryNormalized: listings.laundryNormalized,
  parkingNormalized: listings.parkingNormalized,
  availableDate: listings.availableDate,
  postedAt: listings.postedAt,
  firstSeenAt: listings.firstSeenAt,
  lastSeenAt: listings.lastSeenAt,
  missingSince: listings.missingSince,
  staleStatus: listings.staleStatus,
  listingStatus: listings.listingStatus,
  scamRiskLevel: listings.scamRiskLevel,
  duplicateGroupId: listings.duplicateGroupId,
};

export async function GET() {
  const db = await getDb();

  // Fetch everything the payload needs in one round-trip's worth of latency
  // (these are independent) instead of six sequential Turso round-trips.
  const [rows, states, sourceRows, runs, priceEvents] = await Promise.all([
    db.select(listingCols).from(listings).all(),
    db.select().from(userListingStates).all(),
    db.select().from(sources).all(),
    db
      .select({
        sourceId: sourceRuns.sourceId,
        status: sourceRuns.status,
        startedAt: sourceRuns.startedAt,
      })
      .from(sourceRuns)
      .orderBy(desc(sourceRuns.startedAt))
      .all(),
    db
      .select({
        listingId: listingEvents.listingId,
        oldValue: listingEvents.oldValue,
        newValue: listingEvents.newValue,
        createdAt: listingEvents.createdAt,
      })
      .from(listingEvents)
      .where(eq(listingEvents.eventType, "price_change"))
      .orderBy(desc(listingEvents.createdAt))
      .all(),
  ]);

  const stateByListing = new Map(states.map((s) => [s.listingId, s]));
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));

  // Latest run per source.
  const lastRunBySource = new Map<string, { status: RunStatus; at: string }>();
  for (const run of runs) {
    if (!lastRunBySource.has(run.sourceId)) {
      lastRunBySource.set(run.sourceId, {
        status: run.status as RunStatus,
        at: run.startedAt,
      });
    }
  }

  // Latest price change per listing.
  const lastPriceChange = new Map<string, PriceChangeInfo>();
  for (const ev of priceEvents) {
    if (!lastPriceChange.has(ev.listingId) && ev.oldValue && ev.newValue) {
      lastPriceChange.set(ev.listingId, {
        oldPrice: Number(ev.oldValue),
        newPrice: Number(ev.newValue),
        at: ev.createdAt,
      });
    }
  }

  const payload: ListingSummary[] = rows.map((row) => {
    const state = stateByListing.get(row.id);
    const source = sourceById.get(row.sourceId);
    const lastRun = lastRunBySource.get(row.sourceId) ?? null;
    const priceChange = lastPriceChange.get(row.id) ?? null;
    const badges = computeBadges({
      firstSeenAt: row.firstSeenAt,
      staleStatus: row.staleStatus as never,
      scamRiskLevel: row.scamRiskLevel as never,
      duplicateGroupId: row.duplicateGroupId,
      userStatus: (state?.status as never) ?? null,
      lastPriceChange: priceChange,
      sourceLastRunStatus: lastRun?.status ?? null,
    });
    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceName: source?.name ?? row.sourceId,
      sourceSystem: row.sourceSystem,
      originalUrl: row.originalUrl,
      title: row.title,
      propertyName: row.propertyName,
      neighborhood: row.neighborhood,
      sourceNeighborhoodRaw: row.sourceNeighborhoodRaw,
      addressRaw: row.addressRaw,
      unitNumberPublic: row.unitNumberPublic,
      latitude: row.latitude,
      longitude: row.longitude,
      geocodePrecision: row.geocodePrecision as never,
      priceMonthly: row.priceMonthly,
      priceEffectiveMonthly: row.priceEffectiveMonthly,
      concessionsRaw: row.concessionsRaw,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      squareFeet: row.squareFeet,
      pricePerSquareFoot: row.pricePerSquareFoot,
      primaryPhotoUrl: row.primaryPhotoUrl,
      photoCount: row.photos?.length ?? 0,
      catsAllowed: row.catsAllowed,
      dogsAllowed: row.dogsAllowed,
      laundryNormalized: row.laundryNormalized,
      parkingNormalized: row.parkingNormalized,
      availableDate: row.availableDate,
      postedAt: row.postedAt,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      missingSince: row.missingSince,
      staleStatus: row.staleStatus as never,
      listingStatus: row.listingStatus,
      scamRiskLevel: row.scamRiskLevel as never,
      duplicateGroupId: row.duplicateGroupId,
      userStatus: (state?.status as never) ?? null,
      userNote: state?.note ?? null,
      lastPriceChange: priceChange,
      sourceLastRunStatus: lastRun?.status ?? null,
      sourceLastRunAt: lastRun?.at ?? null,
      badges,
      // Vision tags/search-text aren't read from the list payload (only the
      // detail route + server-side search/digest use them), so they're omitted
      // here to keep this response small.
      visualTags: [],
      visualSearchText: null,
    };
  });

  const body: ListingsResponse = {
    listings: payload,
    generatedAt: new Date().toISOString(),
  };
  // Cache at Vercel's edge so return visits are served instantly from the CDN
  // instead of paying a serverless cold start + DB round-trip every time.
  // stale-while-revalidate keeps loads instant well past the fresh window: an
  // idle-day visit gets the cached copy immediately while a fresh one is fetched
  // in the background. The browser itself doesn't cache (max-age=0), so an
  // in-session reload still reflects optimistic status changes right away.
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
      "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
    },
  });
}
