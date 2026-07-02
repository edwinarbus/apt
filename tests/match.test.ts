import { describe, expect, it } from "vitest";
import { evaluateListing, haversineKm, type MatchableListing, type SavedSearchCriteria } from "@/core/match";

const listing: MatchableListing = {
  priceMonthly: 3150,
  priceEffectiveMonthly: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 720,
  pricePerSquareFoot: 4.38,
  neighborhood: "Lower Haight",
  catsAllowed: true,
  dogsAllowed: true,
  laundryNormalized: "in_unit",
  parkingNormalized: "street",
  availableDate: "2026-07-15",
  latitude: 37.7722,
  longitude: -122.4312,
  title: "Sunny 1BR flat in the heart of Lower Haight w/ in-unit W/D",
  description: "Bright, freshly painted unit close to Duboce Park.",
};

// The canonical example: "1BR or large studio under $3,200, dog-friendly,
// near Lower Haight/Duboce/Castro/Hayes, in-unit or building laundry,
// available within 45 days."
const criteria: SavedSearchCriteria = {
  maxPrice: 3200,
  minBedrooms: 0,
  maxBedrooms: 1,
  minSquareFeet: 450,
  neighborhoods: ["Lower Haight", "Duboce Triangle", "Castro", "Hayes Valley"],
  requireDogsAllowed: true,
  laundry: ["in_unit", "in_building"],
  availableBy: "2026-08-15",
};

describe("evaluateListing", () => {
  it("matches the canonical example search", () => {
    const r = evaluateListing(listing, criteria, null);
    expect(r.matched).toBe(true);
    expect(r.failed).toHaveLength(0);
    expect(r.unknowns).toHaveLength(0);
  });

  it("fails on price, neighborhood, pets, laundry", () => {
    expect(
      evaluateListing({ ...listing, priceMonthly: 3400 }, criteria).failed,
    ).toContain("price:above_max($3400)");
    expect(
      evaluateListing({ ...listing, neighborhood: "Marina" }, criteria).failed,
    ).toContain("neighborhood:Marina");
    expect(
      evaluateListing({ ...listing, dogsAllowed: false }, criteria).failed,
    ).toContain("dogs:not_allowed");
    expect(
      evaluateListing({ ...listing, laundryNormalized: "none" }, criteria).failed,
    ).toContain("laundry:none");
  });

  it("uses effective price when concessions produce one", () => {
    const r = evaluateListing(
      { ...listing, priceMonthly: 3350, priceEffectiveMonthly: 3150 },
      criteria,
    );
    expect(r.matched).toBe(true);
  });

  it("reports unknown fields separately instead of guessing", () => {
    const r = evaluateListing({ ...listing, dogsAllowed: null }, criteria);
    expect(r.matched).toBe(true);
    expect(r.unknowns).toContain("dog_policy");
  });

  it("excludes user-hidden and not-a-fit listings", () => {
    expect(evaluateListing(listing, criteria, "hidden").eligible).toBe(false);
    expect(evaluateListing(listing, criteria, "not_a_fit").matched).toBe(false);
    expect(evaluateListing(listing, criteria, "saved").eligible).toBe(true);
  });

  it("respects availability windows", () => {
    const late = evaluateListing(
      { ...listing, availableDate: "2026-09-01" },
      criteria,
    );
    expect(late.matched).toBe(false);
  });

  it("computes distance and enforces the radius", () => {
    const withRadius: SavedSearchCriteria = {
      ...criteria,
      maxDistanceKm: 1.5,
      centerLat: 37.7695, // Duboce Park
      centerLng: -122.4327,
    };
    const near = evaluateListing(listing, withRadius);
    expect(near.matched).toBe(true);
    expect(near.distanceKm).not.toBeNull();
    expect(near.distanceKm!).toBeLessThan(1);
    const far = evaluateListing(
      { ...listing, latitude: 37.7541, longitude: -122.4951 },
      withRadius,
    );
    expect(far.matched).toBe(false);
  });

  it("handles include/exclude keywords", () => {
    const kw: SavedSearchCriteria = {
      includeKeywords: ["duboce"],
      excludeKeywords: ["basement"],
    };
    expect(evaluateListing(listing, kw).matched).toBe(true);
    expect(
      evaluateListing(
        { ...listing, description: "Cozy basement unit" },
        kw,
      ).matched,
    ).toBe(false);
  });
});

describe("haversineKm", () => {
  it("computes plausible SF distances", () => {
    // Duboce Park to Ferry Building ≈ 3.5-4.5 km
    const d = haversineKm(37.7695, -122.4327, 37.7955, -122.3937);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(5);
  });
});
