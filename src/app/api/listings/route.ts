import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  listingEvents,
  listings,
  listingVision,
  sourceRuns,
  sources,
  userListingStates,
} from "@/db/schema";
import { computeBadges } from "@/lib/badges";
import type { ListingSummary, ListingsResponse, PriceChangeInfo } from "@/lib/api-types";
import type { RunStatus } from "@/core/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();

  const rows = await db.select().from(listings).all();
  const states = await db.select().from(userListingStates).all();
  const stateByListing = new Map(states.map((s) => [s.listingId, s]));

  const sourceRows = await db.select().from(sources).all();
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));

  // Optional AI vision tags/search text (present only for analyzed listings).
  const visionRows = await db
    .select({
      listingId: listingVision.listingId,
      features: listingVision.features,
      searchText: listingVision.searchText,
    })
    .from(listingVision)
    .all();
  const visionByListing = new Map(visionRows.map((v) => [v.listingId, v]));

  // Latest run per source.
  const runs = await db
    .select({
      sourceId: sourceRuns.sourceId,
      status: sourceRuns.status,
      startedAt: sourceRuns.startedAt,
    })
    .from(sourceRuns)
    .orderBy(desc(sourceRuns.startedAt))
    .all();
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
  const priceEvents =
    rows.length > 0
      ? await db
          .select()
          .from(listingEvents)
          .where(eq(listingEvents.eventType, "price_change"))
          .orderBy(desc(listingEvents.createdAt))
          .all()
      : [];
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
    const vision = visionByListing.get(row.id) ?? null;
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
      visualTags: vision?.features ?? [],
      visualSearchText: vision?.searchText ?? null,
    };
  });

  const body: ListingsResponse = {
    listings: payload,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
