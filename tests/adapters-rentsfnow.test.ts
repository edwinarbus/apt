import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRsnDetailPage,
  parseRsnInfo,
  parseRsnResultsPage,
} from "@/adapters/rentsfnow";

// Recorded from the live wpas_ajax_load endpoint + a unit page on 2026-07-01.
const resultsHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "rsn-results-p1.html"),
  "utf8",
);
const detailHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "rsn-detail.html"),
  "utf8",
);

describe("parseRsnResultsPage", () => {
  const page = parseRsnResultsPage(resultsHtml, "https://www.rentsfnow.com");

  it("extracts result cards with ids and urls", () => {
    expect(page.cards.length).toBeGreaterThanOrEqual(10);
    const first = page.cards[0];
    expect(first.postId).toMatch(/^\d+$/);
    expect(first.url).toMatch(/^https:\/\/www\.rentsfnow\.com\/apartments\/rental\//);
  });

  it("reads explicit pagination markers", () => {
    expect(page.currentPage).toBe(1);
    expect(page.lastPage).toBeGreaterThanOrEqual(2);
  });

  it("parses address + unit from the card heading", () => {
    const withUnit = page.cards.find((c) => c.unitNumberPublic);
    expect(withUnit).toBeTruthy();
    expect(withUnit!.addressRaw).toMatch(/\d+ \w+/);
  });

  it("extracts building coordinates from the embedded markers array", () => {
    expect(page.markers.size).toBeGreaterThan(3);
    const anyMarker = [...page.markers.values()][0];
    expect(anyMarker.lat).toBeGreaterThan(37.6);
    expect(anyMarker.lat).toBeLessThan(37.9);
    expect(anyMarker.lng).toBeLessThan(-122.3);
  });

  it("joins at least some cards to marker coordinates", () => {
    const joinable = page.cards.filter(
      (c) =>
        c.addressRaw &&
        page.markers.has(
          c.addressRaw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        ),
    );
    expect(joinable.length).toBeGreaterThan(0);
  });
});

describe("parseRsnInfo", () => {
  it("splits the studio/bath/price line", () => {
    const r = parseRsnInfo("Studio \\\\ 1  Bath \\\\ $1,795");
    expect(r.bedsRaw).toBe("Studio");
    expect(r.bathsRaw).toContain("Bath");
    expect(r.priceRaw).toContain("$1,795");
  });
  it("handles bedrooms", () => {
    const r = parseRsnInfo("2 Beds \\\\ 1 Bath \\\\ $3,400");
    expect(r.bedsRaw).toBe("2 Beds");
  });
  it("tolerates null", () => {
    expect(parseRsnInfo(null).priceRaw).toBeNull();
  });
});

describe("parseRsnDetailPage", () => {
  const detail = parseRsnDetailPage(detailHtml);

  it("extracts square footage", () => {
    expect(detail.squareFeetRaw).toContain("273");
  });

  it("extracts gallery photos from the rentcafe CDN", () => {
    expect(detail.photos.length).toBeGreaterThan(3);
    for (const photo of detail.photos) {
      expect(photo).toMatch(/^https:\/\/cdn\.rentcafe\.com\//);
    }
  });

  it("keeps parenthesized filenames intact (…-01(1).jpg)", () => {
    const withParens = detail.photos.filter((p) => p.includes("("));
    expect(withParens.length).toBeGreaterThan(0);
    for (const p of withParens) {
      expect(p).toMatch(/\(\d+\)\.jpe?g$/i);
    }
  });
});
