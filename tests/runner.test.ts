import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listingEvents, listings, sourceRuns, userListingStates } from "@/db/schema";
import { runSource } from "@/ingest/runner";
import { nowIso, type Db } from "@/db/client";
import { resolveContact } from "@/core/contact";
import { makeListing, seedStubSource, setStubResult, stubSuccess, testDb } from "./helpers";

const OPTS = { skipRobotsCheck: true, geocode: false };

describe("ingestion runner", () => {
  let db: Db;
  beforeEach(() => {
    db = testDb();
    seedStubSource(db);
  });

  it("inserts new listings with first_seen events and records a run", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    const summary = await runSource(db, "stub_src", OPTS);

    expect(summary.status).toBe("success");
    expect(summary.newListings).toBe(2);
    expect(summary.listingsFound).toBe(2);

    const rows = db.select().from(listings).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].firstSeenAt).toBe(rows[0].lastSeenAt);
    expect(rows[0].staleStatus).toBe("active");
    expect(rows[0].contentHash).toBeTruthy();

    const events = db.select().from(listingEvents).all();
    expect(events.filter((e) => e.eventType === "first_seen")).toHaveLength(2);

    const runs = db.select().from(sourceRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].staleProcessed).toBe(true);
    expect(runs[0].paginationCompleted).toBe(true);
  });

  it("upserts unchanged listings without duplicating or fabricating events", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    const second = await runSource(db, "stub_src", OPTS);

    expect(second.newListings).toBe(0);
    expect(second.changedListings).toBe(0);
    expect(db.select().from(listings).all()).toHaveLength(1);
    const events = db.select().from(listingEvents).all();
    expect(events).toHaveLength(1); // just the original first_seen
  });

  it("detects price changes with old/new values", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 3000 })]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 2800 })]);
    const summary = await runSource(db, "stub_src", OPTS);

    expect(summary.priceChangedListings).toBe(1);
    expect(summary.changedListings).toBe(1);
    const event = db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.eventType, "price_change"))
      .get();
    expect(event?.oldValue).toBe("3000");
    expect(event?.newValue).toBe("2800");
    const row = db.select().from(listings).all()[0];
    expect(row.priceMonthly).toBe(2800);
  });

  it("advances the missing chain only across complete successful runs", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);

    // a2 disappears — three successful runs walk the chain.
    for (const expected of ["missing_once", "missing_multiple_runs", "likely_unavailable"]) {
      stubSuccess([makeListing({ sourceListingId: "a1" })]);
      const s = await runSource(db, "stub_src", OPTS);
      expect(s.staleProcessed).toBe(true);
      const a2 = db.select().from(listings).where(eq(listings.sourceListingId, "a2")).get();
      expect(a2?.staleStatus).toBe(expected);
      expect(a2?.missingSince).toBeTruthy();
    }
  });

  it("does NOT advance missing status after a failed run", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await runSource(db, "stub_src", OPTS);

    setStubResult({ fatalError: "boom", pagesVisited: 0 });
    const failed = await runSource(db, "stub_src", OPTS);
    expect(failed.status).toBe("failed");
    expect(failed.staleProcessed).toBe(false);

    const a1 = db.select().from(listings).where(eq(listings.sourceListingId, "a1")).get();
    expect(a1?.staleStatus).toBe("active");
    expect(a1?.missingSince).toBeNull();
    const run = db.select().from(sourceRuns).all().at(-1);
    expect(run?.status).toBe("failed");
    expect(run?.staleProcessed).toBe(false);
  });

  it("does NOT advance missing status after a partial run (incomplete pagination)", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);

    setStubResult({
      listings: [makeListing({ sourceListingId: "a1" })],
      pagesVisited: 1,
      paginationCompleted: false, // e.g. page cap hit
    });
    const partial = await runSource(db, "stub_src", OPTS);
    expect(partial.status).toBe("partial");
    expect(partial.staleProcessed).toBe(false);

    const a2 = db.select().from(listings).where(eq(listings.sourceListingId, "a2")).get();
    expect(a2?.staleStatus).toBe("active");
  });

  it("treats zero listings as partial and skips stale processing", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await runSource(db, "stub_src", OPTS);
    setStubResult({ listings: [], pagesVisited: 1, paginationCompleted: true });
    const s = await runSource(db, "stub_src", OPTS);
    expect(s.status).toBe("partial");
    expect(s.warnings.join(" ")).toContain("zero listings");
    const a1 = db.select().from(listings).all()[0];
    expect(a1.staleStatus).toBe("active");
  });

  it("marks reappeared listings active again with an event", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await runSource(db, "stub_src", OPTS); // a2 -> missing_once
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS); // a2 back

    const a2 = db.select().from(listings).where(eq(listings.sourceListingId, "a2")).get();
    expect(a2?.staleStatus).toBe("active");
    expect(a2?.missingSince).toBeNull();
    const reappear = db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.eventType, "reappeared"))
      .all();
    expect(reappear).toHaveLength(1);
  });

  it("card-depth refreshes never wipe detail fields", async () => {
    stubSuccess([
      makeListing({
        sourceListingId: "a1",
        squareFeet: 720,
        squareFeetRaw: "720 sqft",
        laundryNormalized: "in_unit",
        photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
      }),
    ]);
    await runSource(db, "stub_src", OPTS);

    stubSuccess([
      {
        sourceListingId: "a1",
        originalUrl: "https://example.com/l/a1",
        title: "Listing a1",
        fetchDepth: "card",
        priceMonthly: 3000,
        priceRaw: "$3,000",
      },
    ]);
    await runSource(db, "stub_src", OPTS);

    const row = db.select().from(listings).all()[0];
    expect(row.squareFeet).toBe(720);
    expect(row.laundryNormalized).toBe("in_unit");
    expect(row.photos).toHaveLength(2);
    expect(row.description).toBeTruthy();
  });

  it("detects duplicates across sources by address+unit", async () => {
    seedStubSource(db, "stub_src_b");
    stubSuccess([
      makeListing({
        sourceListingId: "a1",
        addressRaw: "1301 18th Street",
        unitNumberPublic: "2",
      }),
    ]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([
      makeListing({
        sourceListingId: "b9",
        addressRaw: "1301 18th St",
        unitNumberPublic: "2",
        title: "Completely different title",
        priceMonthly: 3100,
        description: "Some other words for this bay view one bedroom on the north slope of Potrero.",
        photos: ["https://elsewhere.com/z.jpg"],
      }),
    ]);
    const s = await runSource(db, "stub_src_b", OPTS);

    expect(s.suspectedDuplicates).toBe(1);
    const rows = db.select().from(listings).all();
    const groups = new Set(rows.map((r) => r.duplicateGroupId).filter(Boolean));
    expect(groups.size).toBe(1);
    expect(rows.every((r) => r.duplicateGroupId != null)).toBe(true);
  });

  it("flags suspicious listings as verify_carefully during ingestion", async () => {
    stubSuccess([
      makeListing({ sourceListingId: "ok1" }),
      makeListing({
        sourceListingId: "scam1",
        title: "LUXURY 2BR unbelievable deal",
        bedrooms: 2,
        priceMonthly: 900,
        description:
          "I am currently out of the country, send deposit via wire transfer before viewing and I will mail you the keys.",
        photos: [],
      }),
    ]);
    const s = await runSource(db, "stub_src", OPTS);
    expect(s.suspectedScams).toBe(1);
    const scam = db.select().from(listings).where(eq(listings.sourceListingId, "scam1")).get();
    expect(scam?.scamRiskLevel).toBe("verify_carefully");
    expect(scam?.scamWarnings?.length).toBeGreaterThan(0);
    const ok = db.select().from(listings).where(eq(listings.sourceListingId, "ok1")).get();
    expect(ok?.scamRiskLevel).toBe("none");
  });

  it("skips disabled sources unless forced", async () => {
    const { sources } = await import("@/db/schema");
    db.update(sources).set({ enabled: false }).where(eq(sources.id, "stub_src")).run();
    const skipped = await runSource(db, "stub_src", OPTS);
    expect(skipped.status).toBe("skipped");
    expect(db.select().from(sourceRuns).all()).toHaveLength(0);

    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    const forced = await runSource(db, "stub_src", { ...OPTS, force: true });
    expect(forced.status).toBe("success");
  });

  it("supports user listing status updates", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await runSource(db, "stub_src", OPTS);
    const row = db.select().from(listings).all()[0];

    db.insert(userListingStates)
      .values({ listingId: row.id, status: "saved", note: "tour sat", updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: userListingStates.listingId,
        set: { status: "saved", note: "tour sat", updatedAt: nowIso() },
      })
      .run();
    db.insert(userListingStates)
      .values({ listingId: row.id, status: "contacted", note: null, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: userListingStates.listingId,
        set: { status: "contacted", note: null, updatedAt: nowIso() },
      })
      .run();

    const state = db.select().from(userListingStates).all();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe("contacted");
  });
});

describe("price history", () => {
  let db: Db;
  beforeEach(() => {
    db = testDb();
    seedStubSource(db);
  });

  it("records a baseline row on first sight and one row per change — never redundant rows", async () => {
    const { priceHistory } = await import("@/db/schema");
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 3000, priceRaw: "$3,000" })]);
    await runSource(db, "stub_src", OPTS);
    expect(db.select().from(priceHistory).all()).toHaveLength(1);

    // Unchanged re-run: no new rows.
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 3000, priceRaw: "$3,000" })]);
    await runSource(db, "stub_src", OPTS);
    expect(db.select().from(priceHistory).all()).toHaveLength(1);

    // Price change: exactly one new row with raw text preserved.
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 2800, priceRaw: "$2,800/mo" })]);
    const s = await runSource(db, "stub_src", OPTS);
    expect(s.priceHistoryEntries).toBe(1);
    const rows = db.select().from(priceHistory).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.priceMonthly).sort()).toEqual([2800, 3000]);
    expect(rows.find((r) => r.priceMonthly === 2800)?.priceRaw).toBe("$2,800/mo");
  });

  it("handles unparseable prices without fabricating values", async () => {
    const { priceHistory } = await import("@/db/schema");
    const callForPrice = makeListing({ sourceListingId: "a1" });
    callForPrice.priceMonthly = null;
    callForPrice.priceRaw = "Call for price";
    stubSuccess([callForPrice]);
    await runSource(db, "stub_src", OPTS);
    const rows = db.select().from(priceHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].priceMonthly).toBeNull();
    expect(rows[0].priceRaw).toBe("Call for price");
  });

  it("records effective-price changes when concessions appear", async () => {
    const { priceHistory } = await import("@/db/schema");
    stubSuccess([makeListing({ sourceListingId: "a1", priceMonthly: 3600 })]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([
      makeListing({
        sourceListingId: "a1",
        priceMonthly: 3600,
        priceEffectiveMonthly: 3300,
        concessionsRaw: "1 month free on 12-month lease",
      }),
    ]);
    await runSource(db, "stub_src", OPTS);
    const rows = db.select().from(priceHistory).all();
    expect(rows).toHaveLength(2);
    const latest = rows.find((r) => r.priceEffectiveMonthly === 3300);
    expect(latest?.concessionsRaw).toContain("1 month free");
  });
});

describe("backfill idempotency", () => {
  it("re-running identical data changes nothing: no dupes, firstSeenAt and history preserved", async () => {
    const db = testDb();
    seedStubSource(db);
    const { priceHistory, listingEvents: events } = await import("@/db/schema");

    const data = () => [
      makeListing({ sourceListingId: "a1", priceMonthly: 3000 }),
      makeListing({ sourceListingId: "a2", priceMonthly: 2500 }),
    ];
    stubSuccess(data());
    await runSource(db, "stub_src", OPTS);
    const firstPass = db.select().from(listings).all();
    const firstSeenById = new Map(firstPass.map((l) => [l.sourceListingId, l.firstSeenAt]));

    for (let i = 0; i < 3; i++) {
      stubSuccess(data());
      const s = await runSource(db, "stub_src", OPTS);
      expect(s.newListings).toBe(0);
      expect(s.changedListings).toBe(0);
      expect(s.unchangedListings).toBe(2);
      expect(s.missingListings).toBe(0);
    }

    const rows = db.select().from(listings).all();
    expect(rows).toHaveLength(2); // no duplicates created
    for (const row of rows) {
      expect(row.firstSeenAt).toBe(firstSeenById.get(row.sourceListingId));
      expect(row.staleStatus).toBe("active");
    }
    expect(db.select().from(priceHistory).all()).toHaveLength(2); // baselines only
    expect(
      db.select().from(events).all().filter((e) => e.eventType === "price_change"),
    ).toHaveLength(0);
  });

  it("staleUpdates:false blocks missing-marking even on a complete successful run", async () => {
    const db = testDb();
    seedStubSource(db);
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);

    stubSuccess([makeListing({ sourceListingId: "a1" })]); // a2 absent
    const s = await runSource(db, "stub_src", { ...OPTS, staleUpdates: false });
    expect(s.staleProcessed).toBe(false);
    expect(s.warnings.join(" ")).toContain("disabled by flag");
    const a2 = db.select().from(listings).where(eq(listings.sourceListingId, "a2")).get();
    expect(a2?.staleStatus).toBe("active");
  });
});

describe("duplicate group persistence", () => {
  it("stores confidence, members, and primary; prunes groups that dissolve", async () => {
    const db = testDb();
    seedStubSource(db);
    seedStubSource(db, "stub_src_b");
    const { duplicateGroups } = await import("@/db/schema");

    stubSuccess([
      makeListing({ sourceListingId: "a1", addressRaw: "1301 18th St", unitNumberPublic: "2" }),
    ]);
    await runSource(db, "stub_src", OPTS);
    stubSuccess([
      makeListing({
        sourceListingId: "b1",
        addressRaw: "1301 18th Street",
        unitNumberPublic: "2",
        title: "Different words entirely",
        priceMonthly: 3100,
        description: "Utterly different description text for the same physical apartment unit.",
        photos: ["https://elsewhere.com/photo.jpg"],
      }),
    ]);
    const s = await runSource(db, "stub_src_b", OPTS);
    expect(s.duplicateGroupsTouched).toBe(1);

    const groups = db.select().from(duplicateGroups).all();
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe("high");
    expect(groups[0].reasons).toContain("same_address_unit");
    expect(groups[0].listingIds).toHaveLength(2);
    expect(groups[0].primaryListingId).toBeTruthy();

    // The duplicate disappears from source B -> after B's next complete run,
    // dedupe re-evaluates db-wide. Marking b1 unavailable dissolves the group.
    const { listings: listingsTable } = await import("@/db/schema");
    db.update(listingsTable)
      .set({ staleStatus: "likely_unavailable" })
      .where(eq(listingsTable.sourceListingId, "b1"))
      .run();
    stubSuccess([
      makeListing({ sourceListingId: "a1", addressRaw: "1301 18th St", unitNumberPublic: "2" }),
    ]);
    await runSource(db, "stub_src", OPTS);
    expect(db.select().from(duplicateGroups).all()).toHaveLength(0);
    const a1 = db.select().from(listingsTable).where(eq(listingsTable.sourceListingId, "a1")).get();
    expect(a1?.duplicateGroupId).toBeNull();
  });
});

describe("contact inheritance", () => {
  it("inherits source contact info unless the listing overrides it", () => {
    const source = {
      name: "RentSFNow",
      phone: "(415) 555-0100",
      email: null,
      contactUrl: "https://www.rentsfnow.com/contact",
      websiteUrl: "https://www.rentsfnow.com",
    };
    const inherited = resolveContact(
      { contactName: null, contactPhone: null, contactEmail: null, contactUrl: null },
      source,
    );
    expect(inherited.inheritedFromSource).toBe(true);
    expect(inherited.contactPhone).toBe("(415) 555-0100");
    expect(inherited.contactName).toBe("RentSFNow");

    const overridden = resolveContact(
      {
        contactName: "Building Manager",
        contactPhone: "(415) 555-0199",
        contactEmail: null,
        contactUrl: null,
      },
      source,
    );
    expect(overridden.inheritedFromSource).toBe(false);
    expect(overridden.contactPhone).toBe("(415) 555-0199");
    expect(overridden.contactUrl).toBe("https://www.rentsfnow.com/contact"); // still falls back per-field
  });
});
