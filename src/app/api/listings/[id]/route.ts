import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  digestRuns,
  duplicateGroups,
  listingEnrichment,
  listingEvents,
  listings,
  listingVision,
  priceHistory,
  sourceRuns,
  sources,
  userListingStates,
} from "@/db/schema";
import { computeBadges } from "@/lib/badges";
import { resolveContact } from "@/core/contact";
import type { Enrichment } from "@/enrich/schema";
import type { Vision } from "@/vision/schema";
import type {
  DuplicateGroupInfo,
  DuplicatePeer,
  EnrichmentPayload,
  ListingDetailResponse,
  PriceChangeInfo,
  VisionPayload,
} from "@/lib/api-types";
import type { RunStatus } from "@/core/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();

  const row = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "listing not found" }, { status: 404 });
  }

  // Everything below depends only on `row` (its id / sourceId / duplicateGroupId),
  // not on each other — so fetch it all in one parallel batch instead of ~8
  // sequential Turso round-trips (the difference between ~2s and ~0.3s here).
  const [
    allSources,
    state,
    events,
    lastRun,
    history,
    enrichRow,
    visionRow,
    peers,
    recentDigestRuns,
  ] = await Promise.all([
    db.select().from(sources).all(),
    db.select().from(userListingStates).where(eq(userListingStates.listingId, id)).get(),
    db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.listingId, id))
      .orderBy(desc(listingEvents.createdAt))
      .all(),
    db
      .select()
      .from(sourceRuns)
      .where(eq(sourceRuns.sourceId, row.sourceId))
      .orderBy(desc(sourceRuns.startedAt))
      .limit(1)
      .get(),
    db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.listingId, id))
      .orderBy(desc(priceHistory.observedAt))
      .all(),
    db.select().from(listingEnrichment).where(eq(listingEnrichment.listingId, id)).get(),
    db.select().from(listingVision).where(eq(listingVision.listingId, id)).get(),
    row.duplicateGroupId
      ? db
          .select()
          .from(listings)
          .where(
            and(
              eq(listings.duplicateGroupId, row.duplicateGroupId),
              ne(listings.id, row.id),
            ),
          )
          .all()
      : Promise.resolve([]),
    db
      .select({ createdAt: digestRuns.createdAt })
      .from(digestRuns)
      .orderBy(desc(digestRuns.createdAt))
      .limit(2)
      .all(),
  ]);

  // Same run-boundary rule as /api/listings — see BadgeInput.newSinceAt.
  const newSinceAt = recentDigestRuns[1]?.createdAt ?? null;

  const source = allSources.find((s) => s.id === row.sourceId) ?? null;
  const sourceNameById = new Map(allSources.map((s) => [s.id, s.name]));

  let duplicates: DuplicatePeer[] = [];
  let duplicateGroup: DuplicateGroupInfo | null = null;
  if (row.duplicateGroupId) {
    duplicates = peers.map((p) => ({
      id: p.id,
      title: p.title,
      sourceId: p.sourceId,
      sourceName: sourceNameById.get(p.sourceId) ?? p.sourceId,
      priceMonthly: p.priceMonthly,
      originalUrl: p.originalUrl,
    }));
    const group = await db
      .select()
      .from(duplicateGroups)
      .where(eq(duplicateGroups.id, row.duplicateGroupId))
      .get();
    if (group) {
      const memberSources = new Set([row.sourceId, ...peers.map((p) => p.sourceId)]);
      duplicateGroup = {
        id: group.id,
        confidence: group.confidence as DuplicateGroupInfo["confidence"],
        reasons: group.reasons ?? [],
        primaryListingId: group.primaryListingId,
        crossSource: memberSources.size > 1,
      };
    }
  }

  let enrichment: EnrichmentPayload | null = null;
  if (enrichRow && enrichRow.data) {
    const d = enrichRow.data as Enrichment;
    enrichment = {
      model: enrichRow.model,
      enrichedAt: enrichRow.enrichedAt,
      summary: enrichRow.summary,
      aiRiskLevel: (enrichRow.aiRiskLevel as EnrichmentPayload["aiRiskLevel"]) ?? null,
      amenities: d.amenities ?? [],
      laundry: d.laundry ?? null,
      parking: d.parking ?? null,
      utilitiesIncluded: d.utilitiesIncluded ?? [],
      verifyBeforeContacting: d.verifyBeforeContacting ?? [],
      questionsForLandlord: d.questionsForLandlord ?? [],
      riskReasons: d.riskReasons ?? [],
    };
  }

  let vision: VisionPayload | null = null;
  if (visionRow && visionRow.data) {
    const v = visionRow.data as Vision;
    vision = {
      model: visionRow.model,
      analyzedAt: visionRow.analyzedAt,
      imageCount: visionRow.imageCount,
      visualSummary: visionRow.visualSummary,
      features: v.features ?? [],
      rooms: v.rooms ?? [],
      condition: v.condition ?? null,
      notes: v.notes ?? null,
    };
  }

  const priceEvent = events.find(
    (e) => e.eventType === "price_change" && e.oldValue && e.newValue,
  );
  const lastPriceChange: PriceChangeInfo | null = priceEvent
    ? {
        oldPrice: Number(priceEvent.oldValue),
        newPrice: Number(priceEvent.newValue),
        at: priceEvent.createdAt,
      }
    : null;

  const contact = resolveContact(
    {
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      contactUrl: row.contactUrl,
    },
    {
      name: source?.name ?? row.sourceId,
      phone: source?.phone ?? null,
      email: source?.email ?? null,
      contactUrl: source?.contactUrl ?? null,
      websiteUrl: source?.websiteUrl ?? null,
    },
  );

  const badges = computeBadges({
    firstSeenAt: row.firstSeenAt,
    staleStatus: row.staleStatus as never,
    scamRiskLevel: row.scamRiskLevel as never,
    duplicateGroupId: row.duplicateGroupId,
    userStatus: (state?.status as never) ?? null,
    lastPriceChange,
    sourceLastRunStatus: (lastRun?.status as RunStatus) ?? null,
    newSinceAt,
  });

  const body: ListingDetailResponse = {
    listing: {
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
      lastPriceChange,
      sourceLastRunStatus: (lastRun?.status as RunStatus) ?? null,
      sourceLastRunAt: lastRun?.startedAt ?? null,
      badges,
      visualTags: visionRow?.features ?? [],
      visualSearchText: visionRow?.searchText ?? null,
      description: row.description,
      photos: row.photos ?? [],
      floorPlanUrls: row.floorPlanUrls ?? [],
      virtualTourUrl: row.virtualTourUrl,
      amenitiesRaw: row.amenitiesRaw ?? [],
      utilitiesIncluded: row.utilitiesIncluded ?? [],
      utilitiesRaw: row.utilitiesRaw,
      petPolicyRaw: row.petPolicyRaw,
      dogRestrictionsRaw: row.dogRestrictionsRaw,
      laundryRaw: row.laundryRaw,
      parkingRaw: row.parkingRaw,
      depositRaw: row.depositRaw,
      depositAmount: row.depositAmount,
      applicationFeeRaw: row.applicationFeeRaw,
      brokerFeeRaw: row.brokerFeeRaw,
      leaseTermRaw: row.leaseTermRaw,
      moveInDate: row.moveInDate,
      priceRaw: row.priceRaw,
      bedroomsRaw: row.bedroomsRaw,
      bathroomsRaw: row.bathroomsRaw,
      squareFeetRaw: row.squareFeetRaw,
      addressNormalized: row.addressNormalized,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      scamWarnings: row.scamWarnings ?? [],
      contactName: contact.contactName,
      contactPhone: contact.contactPhone,
      contactEmail: contact.contactEmail,
      contactUrl: contact.contactUrl,
      contactInheritedFromSource: contact.inheritedFromSource,
      sourceWebsiteUrl: contact.sourceWebsiteUrl,
      showingInfoRaw: row.showingInfoRaw,
      applicationUrl: row.applicationUrl,
      detailFetchedAt: row.detailFetchedAt,
    },
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      oldValue: e.oldValue,
      newValue: e.newValue,
      note: e.note,
      createdAt: e.createdAt,
    })),
    duplicates,
    duplicateGroup,
    priceHistory: history.map((h) => ({
      observedAt: h.observedAt,
      priceRaw: h.priceRaw,
      priceMonthly: h.priceMonthly,
      priceEffectiveMonthly: h.priceEffectiveMonthly,
      concessionsRaw: h.concessionsRaw,
    })),
    enrichment,
    vision,
    newSinceAt,
  };
  // Cache at Vercel's edge so reopening the same listing is instant instead of
  // paying a fresh serverless invocation + ~9-query DB round-trip every time
  // (same trade-off as /api/listings: a status/dislike change made just
  // before reopening can lag up to the s-maxage window before a stale cached
  // copy refreshes — acceptable for a personal single-user tool).
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
      "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
    },
  });
}
