import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listingVision, listings } from "@/db/schema";
import type { Db } from "@/db/client";
import { runSource } from "@/ingest/runner";
import {
  buildVisionContext,
  parseVision,
  type VisionClient,
  type VisionCallResult,
} from "@/vision/client";
import {
  DEFAULT_MAX_IMAGES,
  runVision,
  selectImageUrls,
  selectVisionCandidates,
} from "@/vision/vision";
import { buildVisionSearchText, type Vision, type VisionInput } from "@/vision/schema";
import { makeListing, seedStubSource, stubSuccess, testDb } from "./helpers";

const OPTS = { skipRobotsCheck: true, geocode: false };

const validVision: Vision = {
  visualSummary: "Bright living room with hardwood floors and large bay windows.",
  features: ["hardwood floors", "bay windows", "stainless steel appliances"],
  rooms: [{ room: "kitchen", details: "updated with stainless steel appliances" }],
  condition: "renovated",
  notes: null,
};

const okUsage = { inputTokens: 5000, outputTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 };

/** A fake vision client that records calls and returns scripted results. */
class FakeVisionClient implements VisionClient {
  model = "claude-vision-test";
  calls: VisionInput[] = [];
  constructor(
    private responder: (input: VisionInput) => VisionCallResult = () => ({
      data: validVision,
      error: null,
      usage: { ...okUsage },
      model: "claude-vision-test",
      imageCount: 1,
    }),
  ) {}
  async analyzeOne(input: VisionInput): Promise<VisionCallResult> {
    this.calls.push(input);
    return this.responder(input);
  }
}

describe("parseVision", () => {
  it("parses a clean JSON object", () => {
    expect(parseVision(JSON.stringify(validVision))?.visualSummary).toBe(validVision.visualSummary);
  });
  it("tolerates markdown fences and surrounding prose", () => {
    const fenced = "Sure:\n```json\n" + JSON.stringify(validVision) + "\n```\n";
    expect(parseVision(fenced)?.features).toContain("bay windows");
  });
  it("rejects invalid or incomplete objects", () => {
    expect(parseVision("{}")).toBeNull();
    expect(parseVision("not json")).toBeNull();
    // wrong enum value
    expect(parseVision(JSON.stringify({ ...validVision, condition: "amazing" }))).toBeNull();
  });
});

describe("buildVisionContext", () => {
  it("wraps the listing's own description and facts as grounding context", () => {
    const text = buildVisionContext({
      listingId: "l1",
      title: "Top-floor Victorian 1BR",
      neighborhood: "Noe Valley",
      propertyName: null,
      description: "Sunny unit with restored hardwood floors and original bay windows.",
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 750,
      priceRaw: "$3,500",
      amenitiesRaw: ["dishwasher"],
      imageUrls: ["https://img/1.jpg"],
    });
    expect(text).toContain("<listing_info>");
    expect(text).toContain("Noe Valley");
    expect(text).toContain("1 bd · 1 ba · 750 sqft");
    expect(text).toContain("hardwood floors and original bay windows");
    // framed as context, not ground truth
    expect(text.toLowerCase()).toContain("context");
  });
});

describe("buildVisionSearchText", () => {
  it("combines features, summary, rooms, and condition, lowercased", () => {
    const text = buildVisionSearchText(validVision);
    expect(text).toContain("hardwood floors");
    expect(text).toContain("bay windows");
    expect(text).toContain("kitchen");
    expect(text).toContain("renovated");
    expect(text).toBe(text.toLowerCase());
  });
});

describe("selectImageUrls", () => {
  it("dedupes, drops non-http URLs, and keeps order", () => {
    const urls = selectImageUrls(
      "https://a/p.jpg",
      ["https://a/p.jpg", "https://b/q.jpg", "ftp://x/y.jpg", "/relative.jpg"],
      DEFAULT_MAX_IMAGES,
    );
    expect(urls).toEqual(["https://a/p.jpg", "https://b/q.jpg"]);
  });
  it("caps at maxImages", () => {
    const urls = selectImageUrls(null, ["https://a/1", "https://a/2", "https://a/3"], 2);
    expect(urls).toHaveLength(2);
  });
});

describe("selectVisionCandidates & runVision", () => {
  let db: Db;
  beforeEach(async () => {
    db = await testDb();
    await seedStubSource(db);
    stubSuccess([
      makeListing({ sourceListingId: "a1", photos: ["https://img/a1-1.jpg", "https://img/a1-2.jpg"] }),
      makeListing({ sourceListingId: "a2", photos: ["https://img/a2-1.jpg"] }),
    ]);
    await runSource(db, "stub_src", OPTS);
  });

  it("selects active listings that have photos", async () => {
    const { candidates, skippedNoPhotos } = await selectVisionCandidates(db, {});
    expect(candidates).toHaveLength(2);
    expect(skippedNoPhotos).toBe(0);
  });

  it("skips listings with no usable images", async () => {
    await db
      .update(listings)
      .set({ photos: [], primaryPhotoUrl: null, photoHash: null })
      .where(eq(listings.sourceListingId, "a1"))
      .run();
    const { candidates, skippedNoPhotos } = await selectVisionCandidates(db, {});
    expect(candidates).toHaveLength(1);
    expect(skippedNoPhotos).toBe(1);
  });

  it("caps images per listing via maxImages", async () => {
    await db
      .update(listings)
      .set({ photos: ["https://img/1", "https://img/2", "https://img/3", "https://img/4"] })
      .where(eq(listings.sourceListingId, "a1"))
      .run();
    const { candidates } = await selectVisionCandidates(db, { listingId: undefined, maxImages: 2 });
    const a1 = candidates.find((c) => c.input.imageUrls[0]?.startsWith("https://img/"));
    expect(a1?.input.imageUrls.length).toBe(2);
  });

  it("analyzes, promotes summary/features/searchText, records cost, and is idempotent", async () => {
    const client = new FakeVisionClient();
    const first = await runVision(db, client, {});
    expect(first.succeeded).toBe(2);
    expect(first.costUsd).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(2);

    const rows = await db.select().from(listingVision).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].visualSummary).toBe(validVision.visualSummary);
    expect(rows[0].features).toContain("bay windows");
    expect(rows[0].searchText).toContain("bay windows");
    expect(rows[0].imageCount).toBe(1);

    // Re-run: nothing changed -> no API calls, all skipped.
    const client2 = new FakeVisionClient();
    const second = await runVision(db, client2, {});
    expect(second.skippedUnchanged).toBe(2);
    expect(second.attempted).toBe(0);
    expect(client2.calls).toHaveLength(0);
  });

  it("re-analyzes when a listing's photos (photoHash) change", async () => {
    await runVision(db, new FakeVisionClient(), {});
    // New photos for a1 only -> its photoHash changes.
    stubSuccess([
      makeListing({ sourceListingId: "a1", photos: ["https://img/a1-NEW.jpg"] }),
      makeListing({ sourceListingId: "a2", photos: ["https://img/a2-1.jpg"] }),
    ]);
    await runSource(db, "stub_src", OPTS);

    const client = new FakeVisionClient();
    const summary = await runVision(db, client, {});
    expect(summary.attempted).toBe(1);
    expect(client.calls[0].imageUrls[0]).toBe("https://img/a1-NEW.jpg");
  });

  it("dry-run makes no calls and writes nothing", async () => {
    const client = new FakeVisionClient();
    const summary = await runVision(db, client, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.candidates).toBe(2);
    expect(client.calls).toHaveLength(0);
    expect(await db.select().from(listingVision).all()).toHaveLength(0);
  });

  it("respects the per-run limit", async () => {
    const client = new FakeVisionClient();
    const summary = await runVision(db, client, { limit: 1 });
    expect(summary.attempted).toBe(1);
    expect(summary.candidates).toBe(2);
    expect(await db.select().from(listingVision).all()).toHaveLength(1);
  });

  it("stops at the cost cap", async () => {
    const pricey = new FakeVisionClient(() => ({
      data: validVision,
      error: null,
      usage: { inputTokens: 6_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      model: "claude-vision-test",
      imageCount: 1,
    }));
    const summary = await runVision(db, pricey, { costCapUsd: 5 });
    expect(summary.attempted).toBe(1);
  });

  it("records failures without discarding prior good data, and retries them next run", async () => {
    // First: succeed on both.
    await runVision(db, new FakeVisionClient(), {});
    // New photos so both become eligible again.
    stubSuccess([
      makeListing({ sourceListingId: "a1", photos: ["https://img/a1-v2.jpg"] }),
      makeListing({ sourceListingId: "a2", photos: ["https://img/a2-v2.jpg"] }),
    ]);
    await runSource(db, "stub_src", OPTS);

    const failing = new FakeVisionClient(() => ({
      data: null,
      error: "model refused the request",
      usage: { inputTokens: 300, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      model: "claude-vision-test",
      imageCount: 1,
    }));
    const s1 = await runVision(db, failing, {});
    expect(s1.failed).toBe(2);

    // Prior good data (searchText) is retained even though the last attempt errored.
    const row = (await db.select().from(listingVision).all())[0];
    expect(row.error).toBeTruthy();
    expect(row.searchText).toContain("bay windows");

    // Errored rows are eligible again on the next run.
    expect((await selectVisionCandidates(db, {})).candidates.length).toBe(2);
  });

  it("can target a single listing by id", async () => {
    const a1 = (await db.select().from(listings).where(eq(listings.sourceListingId, "a1")).get())!;
    const client = new FakeVisionClient();
    const summary = await runVision(db, client, { listingId: a1.id });
    expect(summary.attempted).toBe(1);
    expect(client.calls[0].listingId).toBe(a1.id);
  });

  it("skips likely-unavailable listings unless includeInactive is set", async () => {
    await db
      .update(listings)
      .set({ staleStatus: "likely_unavailable" })
      .where(eq(listings.sourceListingId, "a1"))
      .run();
    expect((await selectVisionCandidates(db, {})).candidates).toHaveLength(1);
    expect((await selectVisionCandidates(db, { includeInactive: true })).candidates).toHaveLength(2);
  });
});
