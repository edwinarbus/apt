import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId, nowIso, type Db } from "@/db/client";
import { listings, savedSearches, savedSearchMatches, userListingStates } from "@/db/schema";
import { computeDigest } from "@/ingest/digest";
import type { SavedSearchCriteria } from "@/core/match";
import { runSource } from "@/ingest/runner";
import { makeListing, seedStubSource, stubSuccess, testDb } from "./helpers";

const OPTS = { skipRobotsCheck: true, geocode: false };

function addSearch(db: Db, name: string, criteria: SavedSearchCriteria): string {
  const id = newId("srch");
  const now = nowIso();
  db.insert(savedSearches)
    .values({ id, name, criteria, enabled: true, createdAt: now, updatedAt: now })
    .run();
  return id;
}

describe("computeDigest", () => {
  let db: Db;
  beforeEach(async () => {
    db = testDb();
    seedStubSource(db);
    stubSuccess([
      makeListing({ sourceListingId: "a1", priceMonthly: 3000, bedrooms: 1, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a2", priceMonthly: 4500, bedrooms: 2, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a3", priceMonthly: 2800, bedrooms: 1, neighborhood: "Marina" }),
    ]);
    await runSource(db, "stub_src", OPTS);
  });

  it("reports new matches once, then nothing on re-run (idempotent)", () => {
    addSearch(db, "cheap 1BRs", { maxPrice: 3200, maxBedrooms: 1 });
    const first = computeDigest(db, { dryRun: false });
    expect(first.totalNewMatches).toBe(2); // a1 (Mission) + a3 (Marina), a2 too pricey
    const second = computeDigest(db, { dryRun: false });
    expect(second.totalNewMatches).toBe(0);
  });

  it("dry-run does not mark matches notified", () => {
    addSearch(db, "cheap 1BRs", { maxPrice: 3200, maxBedrooms: 1 });
    expect(computeDigest(db, { dryRun: true }).totalNewMatches).toBe(2);
    expect(computeDigest(db, { dryRun: true }).totalNewMatches).toBe(2);
    // Still nothing recorded as notified.
    const rows = db.select().from(savedSearchMatches).all();
    expect(rows.every((r) => r.notifiedAt == null)).toBe(true);
  });

  it("detects price drops on already-notified matches only", async () => {
    const sid = addSearch(db, "cheap 1BRs", { maxPrice: 3200, maxBedrooms: 1 });
    computeDigest(db, { dryRun: false }); // notifies a1@3000, a3@2800

    // a1 drops to 2700.
    stubSuccess([
      makeListing({ sourceListingId: "a1", priceMonthly: 2700, bedrooms: 1, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a2", priceMonthly: 4500, bedrooms: 2, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a3", priceMonthly: 2800, bedrooms: 1, neighborhood: "Marina" }),
    ]);
    await runSource(db, "stub_src", OPTS);

    const digest = computeDigest(db, { dryRun: false });
    expect(digest.totalNewMatches).toBe(0);
    expect(digest.totalPriceDrops).toBe(1);
    const drop = digest.perSearch[0].priceDrops[0];
    expect(drop.previousPrice).toBe(3000);
    expect(drop.priceMonthly).toBe(2700);
    void sid;
  });

  it("reports matches that stop matching as dropped-out, once", async () => {
    addSearch(db, "cheap 1BRs", { maxPrice: 3200, maxBedrooms: 1 });
    computeDigest(db, { dryRun: false });

    // a3 jumps above the price ceiling.
    stubSuccess([
      makeListing({ sourceListingId: "a1", priceMonthly: 3000, bedrooms: 1, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a2", priceMonthly: 4500, bedrooms: 2, neighborhood: "Mission" }),
      makeListing({ sourceListingId: "a3", priceMonthly: 5000, bedrooms: 1, neighborhood: "Marina" }),
    ]);
    await runSource(db, "stub_src", OPTS);

    const digest = computeDigest(db, { dryRun: false });
    expect(digest.totalDroppedOut).toBe(1);
    expect(digest.perSearch[0].droppedOut[0].listingId).toBeTruthy();
    // Not re-reported next run.
    expect(computeDigest(db, { dryRun: false }).totalDroppedOut).toBe(0);
  });

  it("excludes user-hidden and likely-unavailable listings from matches", () => {
    addSearch(db, "cheap 1BRs", { maxPrice: 3200, maxBedrooms: 1 });
    const a1 = db.select().from(listings).where(eq(listings.sourceListingId, "a1")).get()!;
    db.insert(userListingStates)
      .values({ listingId: a1.id, status: "hidden", note: null, updatedAt: nowIso() })
      .run();
    const digest = computeDigest(db, { dryRun: false });
    // Only a3 remains (a1 hidden, a2 too pricey).
    expect(digest.totalNewMatches).toBe(1);
    expect(digest.perSearch[0].newMatches[0].neighborhood).toBe("Marina");
  });

  it("surfaces unknown fields on matches instead of hiding them", () => {
    // Dog-required search; stub listings have unknown pet policy.
    addSearch(db, "dog friendly", { maxPrice: 3200, maxBedrooms: 1, requireDogsAllowed: true });
    const digest = computeDigest(db, { dryRun: true });
    // Matches (dog policy unknown doesn't fail) but records the unknown.
    expect(digest.totalNewMatches).toBeGreaterThan(0);
    expect(digest.perSearch[0].newMatches[0].unknowns).toContain("dog_policy");
  });

  it("only evaluates enabled saved searches", () => {
    const sid = addSearch(db, "disabled search", { maxPrice: 10000 });
    db.update(savedSearches).set({ enabled: false }).where(eq(savedSearches.id, sid)).run();
    expect(computeDigest(db, { dryRun: true }).savedSearchesEvaluated).toBe(0);
  });
});
