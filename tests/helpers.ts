import { createDb, nowIso, type Db } from "@/db/client";
import { sources } from "@/db/schema";
import { registerAdapter } from "@/adapters/registry";
import type { AdapterRunResult, SourceAdapter } from "@/adapters/types";
import { emptyRunResult } from "@/adapters/types";
import type { NormalizedListing } from "@/core/types";

export async function testDb(): Promise<Db> {
  return createDb(":memory:");
}

export async function seedStubSource(db: Db, id = "stub_src"): Promise<string> {
  const now = nowIso();
  await db
    .insert(sources)
    .values({
      id,
      name: "Stub Source",
      sourceSystem: "direct_html",
      adapterType: "stub",
      priority: "normal",
      enabled: true,
      listingUrl: null, // no robots check
      region: "San Francisco",
      city: "San Francisco",
      state: "CA",
      crawlIntervalHours: 24,
      requestDelayMs: 0,
      timeoutMs: 1000,
      retryCount: 0,
      maxPagesPerRun: 5,
      maxDetailPagesPerRun: 50,
      geocodeEnabled: false,
      permissionStatus: "ok_personal_low_frequency",
      parserVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/**
 * A stub adapter whose next result is set per test. Registered once under
 * adapterType "stub".
 */
let nextResult: AdapterRunResult = emptyRunResult();

export function setStubResult(partial: Partial<AdapterRunResult>): void {
  nextResult = { ...emptyRunResult(), ...partial };
}

export function stubSuccess(listings: NormalizedListing[]): void {
  setStubResult({
    listings,
    pagesVisited: 1,
    pageTrace: [
      { page: 1, url: "stub://1", httpStatus: 200, listingsExtracted: listings.length },
    ],
    paginationCompleted: true,
    detailExtractionCompleted: true,
    totalListingsReportedBySource: listings.length,
  });
}

const stubAdapter: SourceAdapter = {
  adapterType: "stub",
  async run() {
    return nextResult;
  },
};
registerAdapter(stubAdapter);

export function makeListing(
  over: Partial<NormalizedListing> & { sourceListingId: string },
): NormalizedListing {
  return {
    originalUrl: `https://example.com/l/${over.sourceListingId}`,
    title: `Listing ${over.sourceListingId}`,
    fetchDepth: "detail",
    priceMonthly: 3000,
    priceRaw: "$3,000",
    bedrooms: 1,
    bathrooms: 1,
    neighborhood: "Mission",
    city: "San Francisco",
    state: "CA",
    description:
      "A bright and airy one bedroom apartment with hardwood floors and a remodeled kitchen, close to everything.",
    photos: [`https://example.com/photos/${over.sourceListingId}-1.jpg`],
    listingStatus: "active",
    ...over,
  };
}
