import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listings, sources } from "@/db/schema";
import type { Db } from "@/db/client";
import { verifySource } from "@/ingest/verify";
import {
  makeListing,
  seedStubSource,
  setStubResult,
  stubSuccess,
  testDb,
} from "./helpers";

/**
 * Verification uses the stub adapter (registered by helpers) in "live" mode —
 * the stub performs no real network I/O, so these tests stay offline while
 * exercising the full report pipeline.
 */

describe("verifySource", () => {
  let db: Db;
  beforeEach(async () => {
    db = await testDb();
    await seedStubSource(db);
  });

  it("reports PASS for a clean run and persists the outcome", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    const report = await verifySource(db, "stub_src", { mode: "live" });
    expect(report.status).toBe("PASS");
    expect(report.listingsExtracted).toBe(2);
    expect(report.checks.join("\n")).toContain("2/2 listings have original URLs");
    expect(report.staleSafety).toContain("WOULD run");

    const source = await db.select().from(sources).where(eq(sources.id, "stub_src")).get();
    expect(source?.lastVerificationStatus).toBe("PASS");
    expect(source?.lastVerificationAt).toBeTruthy();
  });

  it("never writes listings", async () => {
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    await verifySource(db, "stub_src", { mode: "live" });
    expect(await db.select().from(listings).all()).toHaveLength(0);
  });

  it("reports FAIL on fatal errors and zero listings", async () => {
    setStubResult({ fatalError: "boom" });
    const failed = await verifySource(db, "stub_src", { mode: "live" });
    expect(failed.status).toBe("FAIL");
    expect(failed.errors.join(" ")).toContain("boom");

    setStubResult({ listings: [], pagesVisited: 1, paginationCompleted: true });
    const empty = await verifySource(db, "stub_src", { mode: "live" });
    expect(empty.status).toBe("FAIL");
    expect(empty.errors.join(" ")).toContain("zero listings");
  });

  it("reports PARTIAL on incomplete pagination and contract warnings", async () => {
    setStubResult({
      listings: [makeListing({ sourceListingId: "a1" })],
      pagesVisited: 1,
      paginationCompleted: false,
    });
    const partial = await verifySource(db, "stub_src", { mode: "live" });
    expect(partial.status).toBe("PARTIAL");
    expect(partial.staleSafety).toContain("would NOT run");
  });

  it("reports FAIL on contract errors (duplicate ids)", async () => {
    stubSuccess([
      makeListing({ sourceListingId: "same" }),
      makeListing({ sourceListingId: "same" }),
    ]);
    const report = await verifySource(db, "stub_src", { mode: "live" });
    expect(report.status).toBe("FAIL");
    expect(report.errors.join(" ")).toContain("duplicate_source_listing_id");
  });

  it("skips disabled sources with the registry reason", async () => {
    await db
      .update(sources)
      .set({ enabled: false, registryStatus: "disabled_needs_adapter" })
      .where(eq(sources.id, "stub_src"))
      .run();
    const report = await verifySource(db, "stub_src", { mode: "live" });
    expect(report.status).toBe("SKIPPED");
    expect(report.skippedReason).toContain("needs adapter");
    const source = await db.select().from(sources).where(eq(sources.id, "stub_src")).get();
    expect(source?.lastVerificationStatus).toBe("SKIPPED");
  });

  it("runs disabled sources when forced", async () => {
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, "stub_src")).run();
    stubSuccess([makeListing({ sourceListingId: "a1" })]);
    const report = await verifySource(db, "stub_src", { mode: "live", force: true });
    expect(report.status).toBe("PASS");
  });
});
