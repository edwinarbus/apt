import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { newId } from "@/db/client";
import {
  listingEvents,
  listings,
  priceHistory,
  type ListingRow,
  type SourceRow,
} from "@/db/schema";
import { contentHashFor, descriptionHashFor, photoHashFor } from "@/core/hash";
import { computePricePerSquareFoot } from "@/core/normalize";
import { canonicalizeListingUrl } from "@/core/urls";
import type { NormalizedListing } from "@/core/types";
import { isMissingStatus } from "@/core/stale";

/**
 * Idempotent listing upsert with change tracking.
 *
 * Merge rules:
 * - New listings insert everything; firstSeenAt = lastSeenAt = now.
 * - "card"-depth records only refresh identity/price/liveness fields so a
 *   shallow re-crawl never wipes detail-page data.
 * - "detail"-depth records overwrite fields with non-null parsed values;
 *   nulls never clobber previously known values (parser regressions must not
 *   erase data — the latest raw payload is stored for debugging either way).
 * - Coordinates only improve: a lower-precision fix never replaces a better one.
 */

export interface UpsertOutcome {
  listingId: string;
  kind: "new" | "changed" | "unchanged";
  priceChanged: boolean;
  reappeared: boolean;
  priceHistoryRecorded: boolean;
}

const PRECISION_RANK: Record<string, number> = {
  exact_address: 5,
  building: 4,
  block: 3,
  neighborhood: 2,
  city: 1,
  unknown: 0,
};

function precisionRank(p: string | null | undefined): number {
  return PRECISION_RANK[p ?? "unknown"] ?? 0;
}

function addEvent(
  db: Db,
  listingId: string,
  runId: string | null,
  eventType: string,
  oldValue: string | null,
  newValue: string | null,
  now: string,
  note?: string,
): void {
  db.insert(listingEvents)
    .values({
      id: newId("evt"),
      listingId,
      sourceRunId: runId,
      eventType,
      oldValue,
      newValue,
      note: note ?? null,
      createdAt: now,
    })
    .run();
}

function finalize(source: SourceRow, item: NormalizedListing) {
  const addressNormalized =
    item.addressNormalized ??
    (item.addressRaw
      ? `${item.addressRaw}${item.unitNumberPublic ? ` #${item.unitNumberPublic}` : ""}, ${item.city ?? "San Francisco"}, ${item.state ?? "CA"}`
      : null);
  return {
    addressNormalized,
    canonicalUrl: canonicalizeListingUrl(item.originalUrl),
    pricePerSquareFoot: computePricePerSquareFoot(
      item.priceMonthly ?? null,
      item.squareFeet ?? null,
    ),
    contentHash: contentHashFor(item),
    descriptionHash: descriptionHashFor(item.description),
    photoHash: photoHashFor(item.photos),
  };
}

function recordPriceHistory(
  db: Db,
  listingId: string,
  runId: string,
  now: string,
  item: NormalizedListing,
  fallbackDeposit: string | null,
): void {
  db.insert(priceHistory)
    .values({
      id: newId("prc"),
      listingId,
      sourceRunId: runId,
      observedAt: now,
      priceRaw: item.priceRaw ?? null,
      priceMonthly: item.priceMonthly ?? null,
      priceEffectiveMonthly: item.priceEffectiveMonthly ?? null,
      concessionsRaw: item.concessionsRaw ?? null,
      depositRaw: item.depositRaw ?? fallbackDeposit,
    })
    .run();
}

export function upsertListing(
  db: Db,
  source: SourceRow,
  item: NormalizedListing,
  runId: string,
  now: string,
): UpsertOutcome {
  const computed = finalize(source, item);
  const existing = db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.sourceId, source.id),
        eq(listings.sourceListingId, item.sourceListingId),
      ),
    )
    .get();

  if (!existing) {
    const id = newId("lst");
    const goneAlready =
      item.listingStatus === "removed_by_source" ||
      item.listingStatus === "expired";
    db.insert(listings)
      .values({
        id,
        sourceId: source.id,
        sourceSystem: source.sourceSystem,
        sourceListingId: item.sourceListingId,
        originalUrl: item.originalUrl,
        canonicalUrl: computed.canonicalUrl,
        title: item.title,
        description: item.description ?? null,
        rawDescription: item.rawDescription ?? null,
        propertyName: item.propertyName ?? null,
        unitNumberPublic: item.unitNumberPublic ?? null,
        addressRaw: item.addressRaw ?? null,
        addressNormalized: computed.addressNormalized,
        neighborhood: item.neighborhood ?? null,
        sourceNeighborhoodRaw: item.sourceNeighborhoodRaw ?? null,
        city: item.city ?? null,
        state: item.state ?? null,
        postalCode: item.postalCode ?? null,
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
        geocodePrecision:
          item.latitude != null
            ? (item.geocodePrecision ?? "unknown")
            : "unknown",
        priceRaw: item.priceRaw ?? null,
        priceMonthly: item.priceMonthly ?? null,
        priceEffectiveMonthly: item.priceEffectiveMonthly ?? null,
        concessionsRaw: item.concessionsRaw ?? null,
        depositRaw: item.depositRaw ?? null,
        depositAmount: item.depositAmount ?? null,
        bedroomsRaw: item.bedroomsRaw ?? null,
        bedrooms: item.bedrooms ?? null,
        bathroomsRaw: item.bathroomsRaw ?? null,
        bathrooms: item.bathrooms ?? null,
        squareFeetRaw: item.squareFeetRaw ?? null,
        squareFeet: item.squareFeet ?? null,
        pricePerSquareFoot: computed.pricePerSquareFoot,
        propertyType: item.propertyType ?? null,
        listingType: item.listingType ?? null,
        leaseTermRaw: item.leaseTermRaw ?? null,
        leaseTermMonths: item.leaseTermMonths ?? null,
        moveInDate: item.moveInDate ?? null,
        availableDate: item.availableDate ?? null,
        postedDateRaw: item.postedDateRaw ?? null,
        postedAt: item.postedAt ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        missingSince: goneAlready ? now : null,
        detailFetchedAt: item.fetchDepth === "detail" ? now : null,
        staleStatus: goneAlready ? "likely_unavailable" : "active",
        listingStatus: item.listingStatus ?? "active",
        photos: item.photos ?? [],
        primaryPhotoUrl: item.primaryPhotoUrl ?? item.photos?.[0] ?? null,
        floorPlanUrls: item.floorPlanUrls ?? null,
        virtualTourUrl: item.virtualTourUrl ?? null,
        amenitiesRaw: item.amenitiesRaw ?? null,
        amenitiesNormalized: item.amenitiesNormalized ?? null,
        laundryRaw: item.laundryRaw ?? null,
        laundryNormalized: item.laundryNormalized ?? null,
        parkingRaw: item.parkingRaw ?? null,
        parkingNormalized: item.parkingNormalized ?? null,
        petPolicyRaw: item.petPolicyRaw ?? null,
        catsAllowed: item.catsAllowed ?? null,
        dogsAllowed: item.dogsAllowed ?? null,
        dogRestrictionsRaw: item.dogRestrictionsRaw ?? null,
        utilitiesRaw: item.utilitiesRaw ?? null,
        utilitiesIncluded: item.utilitiesIncluded ?? null,
        applicationFeeRaw: item.applicationFeeRaw ?? null,
        applicationFee: item.applicationFee ?? null,
        brokerFeeRaw: item.brokerFeeRaw ?? null,
        brokerFee: item.brokerFee ?? null,
        contactName: item.contactName ?? null,
        contactPhone: item.contactPhone ?? null,
        contactEmail: item.contactEmail ?? null,
        contactUrl: item.contactUrl ?? null,
        showingInfoRaw: item.showingInfoRaw ?? null,
        applicationUrl: item.applicationUrl ?? null,
        contentHash: computed.contentHash,
        descriptionHash: computed.descriptionHash,
        photoHash: computed.photoHash,
        scamRiskLevel: "none",
        rawPayload: item.rawPayload ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    addEvent(db, id, runId, "first_seen", null, item.priceMonthly?.toString() ?? null, now);
    // Baseline price-history entry (even when price is null/"call for price" —
    // the raw text is the observation).
    recordPriceHistory(db, id, runId, now, item, null);
    return {
      listingId: id,
      kind: "new",
      priceChanged: false,
      reappeared: false,
      priceHistoryRecorded: true,
    };
  }

  return updateExisting(db, existing, item, computed, runId, now);
}

function updateExisting(
  db: Db,
  existing: ListingRow,
  item: NormalizedListing,
  computed: ReturnType<typeof finalize>,
  runId: string,
  now: string,
): UpsertOutcome {
  const patch: Partial<ListingRow> = {
    lastSeenAt: now,
    updatedAt: now,
  };

  // Liveness: a listing seen again leaves the missing chain.
  let reappeared = false;
  if (isMissingStatus(existing.staleStatus as never)) {
    reappeared = true;
    addEvent(db, existing.id, runId, "reappeared", existing.staleStatus, "active", now);
  }
  patch.staleStatus = "active";
  patch.missingSince = null;

  const newListingStatus = item.listingStatus ?? "active";
  if (newListingStatus !== existing.listingStatus) {
    addEvent(
      db, existing.id, runId, "listing_status_change",
      existing.listingStatus, newListingStatus, now,
    );
    patch.listingStatus = newListingStatus;
    if (newListingStatus === "removed_by_source" || newListingStatus === "expired") {
      patch.staleStatus = "likely_unavailable";
      patch.missingSince = existing.missingSince ?? now;
    }
  }

  // Price: track changes at any depth.
  let priceChanged = false;
  if (
    item.priceMonthly != null &&
    existing.priceMonthly != null &&
    item.priceMonthly !== existing.priceMonthly
  ) {
    priceChanged = true;
    addEvent(
      db, existing.id, runId, "price_change",
      String(existing.priceMonthly), String(item.priceMonthly), now,
    );
  }
  if (item.priceMonthly != null) {
    patch.priceMonthly = item.priceMonthly;
    patch.priceRaw = item.priceRaw ?? existing.priceRaw;
    patch.pricePerSquareFoot =
      computePricePerSquareFoot(item.priceMonthly, existing.squareFeet) ??
      existing.pricePerSquareFoot;
  }

  // Price history: a new row only when the observed price or effective price
  // actually differs from what we last knew — re-running a backfill on
  // unchanged data must not append redundant entries.
  const effectiveChanged =
    item.fetchDepth === "detail" &&
    item.priceEffectiveMonthly != null &&
    item.priceEffectiveMonthly !== existing.priceEffectiveMonthly;
  const priceHistoryRecorded = priceChanged || effectiveChanged;
  if (priceHistoryRecorded) {
    recordPriceHistory(db, existing.id, runId, now, item, existing.depositRaw);
  }

  if (!existing.canonicalUrl && computed.canonicalUrl) {
    patch.canonicalUrl = computed.canonicalUrl;
  }

  patch.title = item.title || existing.title;
  if (item.neighborhood && !existing.neighborhood) patch.neighborhood = item.neighborhood;
  if (item.sourceNeighborhoodRaw) patch.sourceNeighborhoodRaw = item.sourceNeighborhoodRaw;

  let contentChanged = false;
  if (item.fetchDepth === "detail") {
    contentChanged = computed.contentHash !== existing.contentHash;
    if (contentChanged && !priceChanged) {
      addEvent(
        db, existing.id, runId, "content_change",
        existing.contentHash, computed.contentHash, now,
      );
    }
    const detailPatch: Partial<ListingRow> = {
      description: item.description ?? existing.description,
      rawDescription: item.rawDescription ?? existing.rawDescription,
      propertyName: item.propertyName ?? existing.propertyName,
      unitNumberPublic: item.unitNumberPublic ?? existing.unitNumberPublic,
      addressRaw: item.addressRaw ?? existing.addressRaw,
      addressNormalized: computed.addressNormalized ?? existing.addressNormalized,
      city: item.city ?? existing.city,
      state: item.state ?? existing.state,
      postalCode: item.postalCode ?? existing.postalCode,
      priceEffectiveMonthly: item.priceEffectiveMonthly ?? existing.priceEffectiveMonthly,
      concessionsRaw: item.concessionsRaw ?? existing.concessionsRaw,
      depositRaw: item.depositRaw ?? existing.depositRaw,
      depositAmount: item.depositAmount ?? existing.depositAmount,
      bedroomsRaw: item.bedroomsRaw ?? existing.bedroomsRaw,
      bedrooms: item.bedrooms ?? existing.bedrooms,
      bathroomsRaw: item.bathroomsRaw ?? existing.bathroomsRaw,
      bathrooms: item.bathrooms ?? existing.bathrooms,
      squareFeetRaw: item.squareFeetRaw ?? existing.squareFeetRaw,
      squareFeet: item.squareFeet ?? existing.squareFeet,
      propertyType: item.propertyType ?? existing.propertyType,
      listingType: item.listingType ?? existing.listingType,
      leaseTermRaw: item.leaseTermRaw ?? existing.leaseTermRaw,
      leaseTermMonths: item.leaseTermMonths ?? existing.leaseTermMonths,
      moveInDate: item.moveInDate ?? existing.moveInDate,
      availableDate: item.availableDate ?? existing.availableDate,
      postedDateRaw: item.postedDateRaw ?? existing.postedDateRaw,
      postedAt: item.postedAt ?? existing.postedAt,
      floorPlanUrls: item.floorPlanUrls ?? existing.floorPlanUrls,
      virtualTourUrl: item.virtualTourUrl ?? existing.virtualTourUrl,
      amenitiesRaw: item.amenitiesRaw ?? existing.amenitiesRaw,
      amenitiesNormalized: item.amenitiesNormalized ?? existing.amenitiesNormalized,
      laundryRaw: item.laundryRaw ?? existing.laundryRaw,
      laundryNormalized: item.laundryNormalized ?? existing.laundryNormalized,
      parkingRaw: item.parkingRaw ?? existing.parkingRaw,
      parkingNormalized: item.parkingNormalized ?? existing.parkingNormalized,
      petPolicyRaw: item.petPolicyRaw ?? existing.petPolicyRaw,
      catsAllowed: item.catsAllowed ?? existing.catsAllowed,
      dogsAllowed: item.dogsAllowed ?? existing.dogsAllowed,
      dogRestrictionsRaw: item.dogRestrictionsRaw ?? existing.dogRestrictionsRaw,
      utilitiesRaw: item.utilitiesRaw ?? existing.utilitiesRaw,
      utilitiesIncluded: item.utilitiesIncluded ?? existing.utilitiesIncluded,
      applicationFeeRaw: item.applicationFeeRaw ?? existing.applicationFeeRaw,
      applicationFee: item.applicationFee ?? existing.applicationFee,
      brokerFeeRaw: item.brokerFeeRaw ?? existing.brokerFeeRaw,
      brokerFee: item.brokerFee ?? existing.brokerFee,
      contactName: item.contactName ?? existing.contactName,
      contactPhone: item.contactPhone ?? existing.contactPhone,
      contactEmail: item.contactEmail ?? existing.contactEmail,
      contactUrl: item.contactUrl ?? existing.contactUrl,
      showingInfoRaw: item.showingInfoRaw ?? existing.showingInfoRaw,
      applicationUrl: item.applicationUrl ?? existing.applicationUrl,
      contentHash: computed.contentHash,
      descriptionHash: computed.descriptionHash ?? existing.descriptionHash,
      detailFetchedAt: now,
      rawPayload: item.rawPayload ?? existing.rawPayload,
    };
    if (item.photos && item.photos.length > 0) {
      detailPatch.photos = item.photos;
      detailPatch.primaryPhotoUrl = item.primaryPhotoUrl ?? item.photos[0];
      detailPatch.photoHash = computed.photoHash;
    }
    Object.assign(patch, detailPatch);
  } else if (item.photos && item.photos.length > 0 && (existing.photos ?? []).length === 0) {
    patch.photos = item.photos;
    patch.primaryPhotoUrl = item.primaryPhotoUrl ?? item.photos[0];
    patch.photoHash = computed.photoHash;
  }

  // Coordinates only improve in precision.
  if (
    item.latitude != null &&
    item.longitude != null &&
    precisionRank(item.geocodePrecision) > precisionRank(existing.geocodePrecision)
  ) {
    patch.latitude = item.latitude;
    patch.longitude = item.longitude;
    patch.geocodePrecision = item.geocodePrecision ?? "unknown";
  }

  db.update(listings).set(patch).where(eq(listings.id, existing.id)).run();

  const changed = contentChanged || priceChanged;
  return {
    listingId: existing.id,
    kind: changed ? "changed" : "unchanged",
    priceChanged,
    reappeared,
    priceHistoryRecorded,
  };
}
