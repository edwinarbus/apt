import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  listingEvents,
  listings,
  sourceRuns,
  sources,
  userListingStates,
} from "@/db/schema";
import { computeBadges } from "@/lib/badges";
import { resolveContact } from "@/core/contact";
import type {
  DuplicatePeer,
  ListingDetailResponse,
  PriceChangeInfo,
} from "@/lib/api-types";
import type { RunStatus } from "@/core/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "listing not found" }, { status: 404 });
  }
  const source = db.select().from(sources).where(eq(sources.id, row.sourceId)).get();
  const state = db
    .select()
    .from(userListingStates)
    .where(eq(userListingStates.listingId, id))
    .get();
  const events = db
    .select()
    .from(listingEvents)
    .where(eq(listingEvents.listingId, id))
    .orderBy(desc(listingEvents.createdAt))
    .all();
  const lastRun = db
    .select()
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, row.sourceId))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(1)
    .get();

  let duplicates: DuplicatePeer[] = [];
  if (row.duplicateGroupId) {
    const peers = db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.duplicateGroupId, row.duplicateGroupId),
          ne(listings.id, row.id),
        ),
      )
      .all();
    duplicates = peers.map((p) => ({
      id: p.id,
      title: p.title,
      sourceId: p.sourceId,
      sourceName: p.sourceId,
      priceMonthly: p.priceMonthly,
      originalUrl: p.originalUrl,
    }));
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
  };
  return NextResponse.json(body);
}
