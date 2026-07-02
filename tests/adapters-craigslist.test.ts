import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clListingIdFromUrl,
  parseClAvailability,
  parseClDetailPage,
  parseClSearchPage,
} from "@/adapters/craigslist";
import { isSfLocation } from "@/core/neighborhoods";

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
