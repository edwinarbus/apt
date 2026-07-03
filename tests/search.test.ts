import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listings, userListingStates } from "@/db/schema";
import { nowIso, type Db } from "@/db/client";
import { runSource } from "@/ingest/runner";
import { assembleCandidates, haversineMi, prerankAndCap, runSearch } from "@/search/search";
import type { SearchCallResult, SearchClient } from "@/search/client";
import type { CandidateProfile } from "@/search/schema";
import { makeListing, seedStubSource, stubSuccess, testDb } from "./helpers";

const OPTS = { skipRobotsCheck: true, geocode: false };
const usage = { inputTokens: 500, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };

class FakeSearchClient implements SearchClient {
  model = "claude-search-test";
  lastCandidates: CandidateProfile[] = [];
  calls = 0;
  constructor(
    private responder: (q: string, c: CandidateProfile[]) => SearchCallResult = (_q, c) => ({
      data: {
        interpretation: "test",
        intentChips: ["studio"],
        matches: c.map((cand, i) => ({ id: cand.id, score: 90 - i, reason: `match ${cand.id}` })),
      },
      error: null,
      usage,
      model: "claude-search-test",
    }),
  ) {}
  async search(query: string, candidates: CandidateProfile[]): Promise<SearchCallResult> {
    this.calls++;
    this.lastCandidates = candidates;
    return this.responder(query, candidates);
  }
}

describe("haversineMi", () => {
  it("computes distance in miles (SF ↔ Oakland ≈ 10 mi)", () => {
    const d = haversineMi({ lat: 37.7793, lng: -122.4193 }, { lat: 37.8044, lng: -122.2712 });
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(12);
  });
  it("is ~0 for the same point", () => {
    expect(haversineMi({ lat: 37.77, lng: -122.42 }, { lat: 37.77, lng: -122.42 })).toBeLessThan(0.001);
  });
});

describe("assembleCandidates", () => {
  let db: Db;
  beforeEach(async () => {
    db = testDb();
    seedStubSource(db);
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);
    db.update(listings).set({ latitude: 37.78, longitude: -122.42 }).where(eq(listings.sourceListingId, "a1")).run();
    db.update(listings).set({ latitude: 37.335, longitude: -121.89 }).where(eq(listings.sourceListingId, "a2")).run();
  });

  it("builds a profile for each active listing", () => {
    const c = assembleCandidates(db, { query: "x" });
    expect(c).toHaveLength(2);
    expect(c[0].title).toContain("Listing");
  });

  it("filters by radius from the user's location", () => {
    const c = assembleCandidates(db, {
      query: "x",
      location: { lat: 37.78, lng: -122.42 },
      radiusMi: 10,
    });
    // a2 (San Jose, ~40mi) is excluded; a1 (~0mi) stays.
    expect(c).toHaveLength(1);
    expect(c[0].distanceMi).not.toBeNull();
    expect(c[0].distanceMi!).toBeLessThan(1);
  });

  it("excludes hidden / not-a-fit unless includeHiddenGone is set", () => {
    const a1 = db.select().from(listings).where(eq(listings.sourceListingId, "a1")).get()!;
    db.insert(userListingStates).values({ listingId: a1.id, status: "hidden", updatedAt: nowIso() }).run();
    expect(assembleCandidates(db, { query: "x" })).toHaveLength(1);
    expect(assembleCandidates(db, { query: "x", includeHiddenGone: true })).toHaveLength(2);
  });

  it("does not truncate a small-neighborhood match away before pre-rank (regression)", async () => {
    // A large dataset where the only two Outer Richmond listings sit past the
    // old hard 600-cap; without a location sort they must still survive to the
    // relevance pre-rank rather than being dropped in DB order.
    stubSuccess(
      Array.from({ length: 700 }, (_, i) =>
        makeListing({
          sourceListingId: `bulk_${i}`,
          neighborhood: i >= 650 ? "Outer Richmond" : "Mission",
        }),
      ),
    );
    await runSource(db, "stub_src", OPTS);
    const all = assembleCandidates(db, { query: "outer richmond" });
    const outer = all.filter((c) => c.neighborhood === "Outer Richmond");
    expect(outer.length).toBeGreaterThan(0);
    const ranked = prerankAndCap("outer richmond", all, 60);
    expect(ranked.some((c) => c.neighborhood === "Outer Richmond")).toBe(true);
  });
});

describe("prerankAndCap", () => {
  const mk = (id: string, title: string): CandidateProfile => ({
    id,
    title,
    neighborhood: null,
    addressRaw: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    priceMonthly: null,
    laundry: null,
    parking: null,
    catsAllowed: null,
    dogsAllowed: null,
    amenities: [],
    visualFeatures: [],
    visualSummary: null,
    descriptionSnippet: null,
    distanceMi: null,
  });

  it("returns everything when under the cap", () => {
    const c = [mk("a", "x"), mk("b", "y")];
    expect(prerankAndCap("studio", c, 5)).toHaveLength(2);
  });

  it("keeps the most query-relevant candidates when over the cap", () => {
    const cands = [
      mk("miss", "garage parking only, no frills"),
      mk("hit1", "sunny studio with hardwood floors and bay windows in the marina"),
      mk("hit2", "marina studio, hardwood"),
    ];
    const top = prerankAndCap("studio hardwood bay windows marina", cands, 2);
    expect(top).toHaveLength(2);
    expect(top.map((c) => c.id)).toContain("hit1");
    expect(top.map((c) => c.id)).not.toContain("miss");
  });
});

describe("runSearch", () => {
  let db: Db;
  beforeEach(async () => {
    db = testDb();
    seedStubSource(db);
    stubSuccess([makeListing({ sourceListingId: "a1" }), makeListing({ sourceListingId: "a2" })]);
    await runSource(db, "stub_src", OPTS);
  });

  it("ranks matches, drops hallucinated ids, and orders by score", async () => {
    const client = new FakeSearchClient((_q, c) => ({
      data: {
        interpretation: "studios",
        intentChips: ["studio"],
        matches: [
          { id: c[1].id, score: 70, reason: "b" },
          { id: c[0].id, score: 95, reason: "a" },
          { id: "lst_hallucinated", score: 99, reason: "nope" },
        ],
      },
      error: null,
      usage,
      model: "claude-search-test",
    }));
    const r = await runSearch(db, client, { query: "studios" });
    expect(r.matches).toHaveLength(2); // hallucinated id dropped
    expect(r.matches[0].id).toBe(client.lastCandidates[0].id);
    expect(r.matches[0].score).toBe(95);
    expect(r.interpretation).toBe("studios");
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("clamps out-of-range scores to 0–100", async () => {
    const client = new FakeSearchClient((_q, c) => ({
      data: { interpretation: "", intentChips: [], matches: [{ id: c[0].id, score: 150, reason: "x" }] },
      error: null,
      usage,
      model: "m",
    }));
    const r = await runSearch(db, client, { query: "x" });
    expect(r.matches[0].score).toBe(100);
  });

  it("short-circuits with no candidates and never calls the model", async () => {
    for (const l of db.select().from(listings).all()) {
      db.insert(userListingStates).values({ listingId: l.id, status: "hidden", updatedAt: nowIso() }).run();
    }
    const client = new FakeSearchClient();
    const r = await runSearch(db, client, { query: "x" });
    expect(r.candidateCount).toBe(0);
    expect(r.matches).toHaveLength(0);
    expect(client.calls).toBe(0);
  });

  it("surfaces a model error", async () => {
    const client = new FakeSearchClient(() => ({ data: null, error: "boom", usage, model: "m" }));
    const r = await runSearch(db, client, { query: "x" });
    expect(r.error).toBe("boom");
    expect(r.matches).toHaveLength(0);
  });

  it("emits live progress events (assemble → prerank with the real shortlist ids)", async () => {
    const events: string[] = [];
    let prerankIds: string[] = [];
    await runSearch(db, new FakeSearchClient(), { query: "x" }, (e) => {
      events.push(e.type === "stage" ? e.stage : e.type);
      if (e.type === "stage" && e.stage === "prerank") prerankIds = e.ids;
    });
    expect(events).toEqual(["assemble", "prerank"]); // model events come from the live client
    // The ids are the actual shortlisted listings, so the radar can target them.
    expect(prerankIds).toHaveLength(2);
    expect(prerankIds.every((id) => id.startsWith("lst_"))).toBe(true);
  });
});
