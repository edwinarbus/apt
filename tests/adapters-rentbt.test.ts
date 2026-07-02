import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildListingFromApi, type BtApiResponse } from "@/adapters/rentbt";

// Recorded from the live JSON feed on 2026-07-02:
//   https://rentbt.com/wp-json/property-search/v1/data/
// Refresh with `npm run fixtures:refresh -- --source brick_and_timber`.
const api = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "fixtures", "bt-api.json"), "utf8"),
) as BtApiResponse;

const propertyById = new Map(api.properties.map((p) => [p.propertyId, p]));
const build = (apt: (typeof api.apartments)[number]) =>
  buildListingFromApi(apt, propertyById.get(apt.propertyId), "https://rentbt.com");

describe("rentbt JSON feed", () => {
  it("has the expected shape", () => {
    expect(api.apartments.length).toBeGreaterThan(50);
    expect(api.properties.length).toBeGreaterThan(50);
  });
});

describe("buildListingFromApi", () => {
  const listings = api.apartments.map(build).filter((l) => l !== null);

  it("keeps SF units and drops East Bay ones", () => {
    // Recorded feed: 63 SF units + 50 Berkeley units (Berkeley buildings pack
    // many units each), so ~55% survive the SF filter.
    expect(listings.length).toBeGreaterThan(50);
    expect(listings.length).toBeLessThan(api.apartments.length);
  });

  it("returns null for a Berkeley unit", () => {
    const berkeleyApt = api.apartments.find((a) => {
      const p = propertyById.get(a.propertyId);
      return p && /berkeley/i.test(p.city);
    });
    expect(berkeleyApt).toBeTruthy();
    expect(build(berkeleyApt!)).toBeNull();
  });

  it("populates the contract-critical fields on every SF listing", () => {
    for (const l of listings) {
      expect(l!.originalUrl).toMatch(/^https:\/\/rentbt\.com\/listing\/\d+-\d+$/);
      expect(l!.sourceListingId).toMatch(/^\d+-\d+$/);
      expect(l!.title.length).toBeGreaterThan(3);
      expect(l!.city).toBe("San Francisco");
    }
  });

  it("has strong coverage of price, beds, coordinates and photos", () => {
    const withPrice = listings.filter((l) => l!.priceMonthly != null).length;
    const withBeds = listings.filter((l) => l!.bedrooms != null).length;
    const withCoords = listings.filter((l) => l!.latitude != null).length;
    const withPhotos = listings.filter((l) => (l!.photos?.length ?? 0) > 0).length;
    expect(withPrice / listings.length).toBeGreaterThan(0.9);
    expect(withBeds / listings.length).toBeGreaterThan(0.9);
    expect(withCoords / listings.length).toBeGreaterThan(0.9);
    expect(withPhotos / listings.length).toBeGreaterThan(0.8);
  });

  it("uses exact building coordinates (no geocoding needed)", () => {
    const withCoords = listings.find((l) => l!.latitude != null)!;
    expect(withCoords.geocodePrecision).toBe("building");
    expect(withCoords.latitude!).toBeGreaterThan(37.6);
    expect(withCoords.latitude!).toBeLessThan(37.85);
  });

  it("parses a specific known unit correctly (1077 Ashbury #1081C)", () => {
    const apt = api.apartments.find((a) => a.apartmentId === "29855262");
    expect(apt).toBeTruthy();
    const l = build(apt!)!;
    expect(l.addressRaw).toBe("1077 Ashbury Street");
    expect(l.unitNumberPublic).toBe("1081C");
    expect(l.priceMonthly).toBe(4585);
    expect(l.bedrooms).toBe(1);
    expect(l.bathrooms).toBe(1);
    expect(l.squareFeet).toBe(400);
    expect(l.neighborhood).toBe("Haight-Ashbury");
    expect(l.photos!.length).toBeGreaterThan(3);
    expect(l.photos![0]).toMatch(/^https:\/\/cdn\.rentcafe\.com\//);
    expect(l.applicationUrl).toContain("securecafe");
  });

  it("maps concessions into effective price (synthetic SF unit)", () => {
    // No SF unit carries a special in the recorded feed (they're all on
    // Berkeley units), so exercise the wiring with a controlled SF input.
    const sfProperty = api.properties.find((p) => /san francisco/i.test(p.city))!;
    const base = api.apartments.find(
      (a) => a.propertyId === sfProperty.propertyId,
    )!;
    const withSpecial = buildListingFromApi(
      { ...base, minrent: "3600", maxrent: "3600", specials: "One month free when you sign by 7/15" },
      sfProperty,
      "https://rentbt.com",
    )!;
    expect(withSpecial.concessionsRaw).toContain("One month free");
    expect(withSpecial.priceEffectiveMonthly).toBe(3300); // 3600 * 11/12
  });

  it("has no duplicate source listing ids or original URLs", () => {
    const ids = new Set<string>();
    const urls = new Set<string>();
    for (const l of listings) {
      expect(ids.has(l!.sourceListingId)).toBe(false);
      expect(urls.has(l!.originalUrl)).toBe(false);
      ids.add(l!.sourceListingId);
      urls.add(l!.originalUrl);
    }
  });
});
