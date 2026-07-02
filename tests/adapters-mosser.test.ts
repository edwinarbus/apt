import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildListingFromFloorplan,
  extractFloorplansBlob,
} from "@/adapters/mosser";

// Recorded from the live RentPress property pages on 2026-07-02. Refresh with
// `npm run fixtures:refresh -- --source mosser_living`.
const singleHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "mosser-property-single.html"),
  "utf8",
);
const multiHtml = fs.readFileSync(
  path.join(process.cwd(), "fixtures", "mosser-property-multi.html"),
  "utf8",
);

describe("extractFloorplansBlob", () => {
  it("parses the single-quoted, HTML-escaped data-floorplans blob", () => {
    const fps = extractFloorplansBlob(singleHtml);
    expect(fps.length).toBeGreaterThan(0);
    expect(fps[0].property_city).toBe("San Francisco");
    expect(fps[0]).toHaveProperty("floorplan_rent_best");
  });

  it("returns [] when there is no blob", () => {
    expect(extractFloorplansBlob("<html><body>nothing</body></html>")).toEqual([]);
  });
});

describe("buildListingFromFloorplan", () => {
  const listings = extractFloorplansBlob(singleHtml)
    .map(buildListingFromFloorplan)
    .filter((l): l is NonNullable<typeof l> => l !== null);

  it("builds available SF floorplan listings", () => {
    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.city).toBe("San Francisco");
      expect(l.sourceListingId).toMatch(/.+-.+/);
      expect(l.originalUrl).toMatch(/^https:\/\/www\.mosserliving\.com\//);
      expect(l.title.length).toBeGreaterThan(3);
    }
  });

  it("has exact building coordinates and neighborhood", () => {
    const withCoords = listings.find((l) => l.latitude != null);
    expect(withCoords).toBeTruthy();
    expect(withCoords!.geocodePrecision).toBe("building");
    expect(withCoords!.latitude!).toBeGreaterThan(37.6);
    expect(withCoords!.latitude!).toBeLessThan(37.85);
    // 1158 Montgomery is in Russian Hill per the feed.
    expect(withCoords!.neighborhood).toBe("Russian Hill");
  });

  it("parses rent, beds and sqft from the floorplan fields", () => {
    const priced = listings.find((l) => l.priceMonthly != null)!;
    expect(priced.priceMonthly!).toBeGreaterThan(1000);
    expect(priced.bedrooms).not.toBeNull();
    expect(priced.squareFeet).not.toBeNull();
  });

  it("treats RentPress 'None' strings as null, not literal values", () => {
    for (const l of listings) {
      expect(l.description).not.toBe("None");
      expect(l.neighborhood).not.toBe("None");
      expect(l.depositRaw).not.toBe("$None");
    }
  });

  it("drops non-SF and unavailable floorplans", () => {
    const notSf = buildListingFromFloorplan({
      property_city: "Oakland",
      property_code: "p1",
      floorplan_code: "f1",
      floorplan_available: "1",
      floorplan_post_link: "https://www.mosserliving.com/floorplans/x/",
    });
    expect(notSf).toBeNull();
    const unavailable = buildListingFromFloorplan({
      property_city: "San Francisco",
      property_code: "p1",
      floorplan_code: "f1",
      floorplan_available: "0",
      floorplan_units_available: "0",
      floorplan_post_link: "https://www.mosserliving.com/floorplans/x/",
    });
    expect(unavailable).toBeNull();
  });

  it("also parses the multi-property fixture without error", () => {
    const multi = extractFloorplansBlob(multiHtml)
      .map(buildListingFromFloorplan)
      .filter(Boolean);
    expect(Array.isArray(multi)).toBe(true);
  });
});
