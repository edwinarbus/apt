import { describe, expect, it } from "vitest";
import { nowIso, type Db } from "@/db/client";
import { sources } from "@/db/schema";
import { SOURCE_SEEDS } from "@/config/sources";
import { verifySource } from "@/ingest/verify";
import { testDb } from "./helpers";

/**
 * End-to-end fixture verification of the REAL adapters: the adapter runs
 * unmodified against a FixtureFetcher serving the recorded HTML, then the
 * report pipeline judges the result. This is what `npm run sources:verify`
 * does in its default offline mode.
 */

async function seedReal(db: Db, id: string): Promise<void> {
  const seed = SOURCE_SEEDS.find((s) => s.id === id)!;
  const now = nowIso();
  await db.insert(sources).values({ ...seed, createdAt: now, updatedAt: now }).run();
}

describe("fixture-mode verification of real adapters", () => {
  it("craigslist_sf verifies PASS against recorded fixtures", async () => {
    const db = await testDb();
    await seedReal(db, "craigslist_sf");
    const report = await verifySource(db, "craigslist_sf", { mode: "fixture" });
    expect(report.status).toBe("PASS");
    expect(report.listingsExtracted).toBeGreaterThan(300);
    expect(report.stats!.withOriginalUrl).toBe(report.stats!.total);
    expect(report.stats!.withPrice / report.stats!.total).toBeGreaterThan(0.9);
    expect(report.errors).toHaveLength(0);
    // Craigslist's static cap means missing-tracking must not run.
    expect(report.staleSafety).toContain("would NOT run");
  });

  it("rentsfnow verifies PASS with complete pagination against fixtures", async () => {
    const db = await testDb();
    await seedReal(db, "rentsfnow");
    const report = await verifySource(db, "rentsfnow", { mode: "fixture" });
    expect(report.status).toBe("PASS");
    expect(report.listingsExtracted).toBeGreaterThanOrEqual(10);
    expect(report.paginationCompleted).toBe(true);
    expect(report.staleSafety).toContain("WOULD run");
  });

  it("reference-only sources report SKIPPED", async () => {
    const db = await testDb();
    await seedReal(db, "zillow_sf");
    const report = await verifySource(db, "zillow_sf", { mode: "fixture" });
    expect(report.status).toBe("SKIPPED");
    expect(report.skippedReason).toContain("reference-only");
  });
});
