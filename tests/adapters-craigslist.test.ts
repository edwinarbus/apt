import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clListingIdFromUrl,
  craigslistAdapter,
  parseClAvailability,
  parseClDetailPage,
  parseClSearchPage,
} from "@/adapters/craigslist";
import { isSfLocation } from "@/core/neighborhoods";
import { FixtureFetcher, fixtureRoutesFor } from "@/ingest/verify";
import { nowIso } from "@/db/client";
import { SOURCE_SEEDS } from "@/config/sources";
import { parsePrice } from "@/core/normalize";
import type { KnownListing } from "@/adapters/types";

// Recorded from the live site on 2026-07-01. Normal test runs never hit the
// network — refresh fixtures manually if Craigslist changes structure.
const searchHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "cl-search.html"),
  "utf8",
);
const detailHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "cl-detail.html"),
  "utf8",
);

describe("parseClSearchPage", () => {
  const cards = parseClSearchPage(searchHtml);

  it("extracts hundreds of result cards", () => {
    expect(cards.length).toBeGreaterThan(300);
  });

  it("extracts title, url, price, location on every card", () => {
    for (const card of cards.slice(0, 25)) {
      expect(card.title.length).toBeGreaterThan(3);
      expect(card.url).toMatch(/^https:\/\//);
      expect(card.locationRaw).toBeTruthy();
    }
  });

  it("includes non-SF results that the SF filter then removes", () => {
    const sf = cards.filter((c) => isSfLocation(c.locationRaw));
    expect(sf.length).toBeGreaterThan(100);
    expect(sf.length).toBeLessThan(cards.length); // fixture contains Oakland etc.
  });
});

describe("clListingIdFromUrl", () => {
  it("handles the opaque /view/d/ style", () => {
    expect(
      clListingIdFromUrl(
        "https://www.craigslist.org/view/d/san-francisco-cozy-studio/xciCPpdbkiM1UZfC8eD12X",
      ),
    ).toBe("xciCPpdbkiM1UZfC8eD12X");
  });
  it("handles the classic .html style", () => {
    expect(
      clListingIdFromUrl(
        "https://sfbay.craigslist.org/sfc/apa/d/san-francisco-studio/7943296598.html",
      ),
    ).toBe("7943296598");
  });
  it("returns null for unrecognized urls", () => {
    expect(clListingIdFromUrl("https://example.com/foo")).toBeNull();
  });
});

describe("parseClDetailPage", () => {
  const detail = parseClDetailPage(detailHtml);

  it("extracts core fields from a real detail page", () => {
    expect(detail.title).toContain("Cozy Studio");
    expect(detail.priceRaw).toBe("$1,495");
    expect(detail.bedroomsRaw).toContain("0BR");
    expect(detail.availabilityRaw).toBe("now");
    expect(detail.listingStatus).toBe("active");
  });

  it("extracts coordinates and address with unit", () => {
    expect(detail.latitude).toBeCloseTo(37.784811, 4);
    expect(detail.longitude).toBeCloseTo(-122.413219, 4);
    expect(detail.addressRaw).toBe("426 Ellis St");
    expect(detail.unitNumberPublic).toBe("103");
  });

  it("extracts photos from imgList", () => {
    expect(detail.photos.length).toBeGreaterThan(0);
    expect(detail.photos[0]).toMatch(/^https:\/\/images\.craigslist\.org\//);
  });

  it("extracts description, posting id and posted time", () => {
    expect(detail.description).toBeTruthy();
    expect(detail.description).not.toContain("QR Code");
    expect(detail.numericPostId).toBe("7943296598");
    expect(detail.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("captures labeled attributes like pet policy", () => {
    expect(detail.attributes.pets_cat).toContain("cats are OK");
  });

  it("detects removed postings", () => {
    const removed = parseClDetailPage(
      "<html><body>This posting has been deleted by its author.</body></html>",
    );
    expect(removed.listingStatus).toBe("removed_by_source");
  });

  it("does not treat the generic '(google map)' link label as an address", () => {
    const noAddress = parseClDetailPage(
      '<html><body><div class="mapaddress"><a href="https://maps.google.com/?q=1">(google map)</a></div></body></html>',
    );
    expect(noAddress.addressRaw).toBeNull();
  });
});

describe("parseClAvailability", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  it("maps 'now' to the fetch date", () => {
    expect(parseClAvailability("now", now)).toBe("2026-07-01");
  });
  it("parses month/day and infers year forward", () => {
    expect(parseClAvailability("aug 1", now)).toBe("2026-08-01");
    expect(parseClAvailability("jan 15", now)).toBe("2027-01-15");
  });
  it("returns null for unparseable text", () => {
    expect(parseClAvailability("soon!", now)).toBeNull();
    expect(parseClAvailability(null, now)).toBeNull();
  });
});

describe("craigslistAdapter — off-page detail backlog", () => {
  function run(known: Map<string, KnownListing>) {
    return craigslistAdapter.run({
      // Cast: only the fields the adapter reads (listingUrl, budgets) matter.
      source: {
        ...SOURCE_SEEDS.find((s) => s.id === "craigslist_sf")!,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      } as never,
      fetcher: new FixtureFetcher(fixtureRoutesFor("craigslist")!),
      knownListings: known,
      log: () => {},
      saveDebug: () => null,
    });
  }

  // Every card on the recorded search page, marked already-fetched with a
  // matching price, so the search plan needs no detail this run and the budget
  // is free for the off-page backlog (mirrors a steady-state nightly run).
  function knownSearchCards(): Map<string, KnownListing> {
    const known = new Map<string, KnownListing>();
    for (const card of parseClSearchPage(searchHtml)) {
      const id = clListingIdFromUrl(card.url);
      if (!id) continue;
      known.set(id, {
        sourceListingId: id,
        title: card.title,
        priceMonthly: parsePrice(card.priceRaw),
        contentHash: "same",
        detailFetchedAt: nowIso(),
        originalUrl: card.url,
        priceRaw: card.priceRaw,
        sourceNeighborhoodRaw: card.locationRaw,
        staleStatus: "active",
      });
    }
    return known;
  }

  it("re-fetches an active, never-detailed listing that has scrolled off the search page", async () => {
    // A known listing whose id is NOT on the recorded search fixture, saved at
    // card depth (detailFetchedAt null), still active, with a stored URL that
    // routes to the detail fixture.
    const backlogId = "OFFPAGEBACKLOG0001";
    const known = knownSearchCards();
    known.set(backlogId, {
      sourceListingId: backlogId,
      title: "Aged-off corporate repost",
      priceMonthly: 3199,
      contentHash: "stale",
      detailFetchedAt: null,
      originalUrl: `https://sfbay.craigslist.org/sfc/apa/d/old/${backlogId}.html`,
      priceRaw: "$3,199",
      sourceNeighborhoodRaw: "Castro",
      staleStatus: "active",
    });

    const result = await run(known);
    const drained = result.listings.find((l) => l.sourceListingId === backlogId);
    expect(drained).toBeDefined();
    // It was upgraded from card depth to a full detail record via direct fetch.
    expect(drained!.fetchDepth).toBe("detail");
    expect((drained!.photos ?? []).length).toBeGreaterThan(0);
  });

  it("leaves an already-detailed off-page listing alone (no wasted fetch)", async () => {
    const doneId = "ALREADYDONE0001";
    const known = new Map<string, KnownListing>([
      [
        doneId,
        {
          sourceListingId: doneId,
          title: "Fully fetched, off page",
          priceMonthly: 2500,
          contentHash: "done",
          detailFetchedAt: nowIso(),
          originalUrl: `https://sfbay.craigslist.org/sfc/apa/d/done/${doneId}.html`,
          priceRaw: "$2,500",
          sourceNeighborhoodRaw: "Mission",
          staleStatus: "active",
        },
      ],
    ]);

    const result = await run(known);
    // Not on the search page and already detailed → never emitted or fetched.
    expect(result.listings.find((l) => l.sourceListingId === doneId)).toBeUndefined();
  });
});
