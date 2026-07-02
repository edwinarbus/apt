import { describe, expect, it } from "vitest";
import { assessListing, computeBaselines } from "@/core/scam";

const clean = {
  title: "Sunny 1BR near Duboce Park",
  description:
    "Bright one bedroom with hardwood floors, updated kitchen, shared laundry. Come see it at the open house Saturday.",
  priceMonthly: 3100,
  squareFeet: 700,
  bedrooms: 1,
  neighborhood: "Duboce Triangle",
  addressRaw: "150 Duboce Ave",
  latitude: 37.769,
  longitude: -122.4315,
  photoCount: 4,
};

describe("assessListing", () => {
  it("passes a normal listing with no warnings", () => {
    const a = assessListing(clean, null);
    expect(a.level).toBe("none");
    expect(a.warnings).toHaveLength(0);
  });

  it("flags far-below-baseline prices using the static citywide baseline", () => {
    const a = assessListing(
      { ...clean, priceMonthly: 950, bedrooms: 2, squareFeet: null },
      null,
    );
    expect(a.level).toBe("verify_carefully");
    expect(a.warnings.join(" ")).toContain("price_far_below_baseline");
  });

  it("prefers computed neighborhood medians when enough data exists", () => {
    const baselines = computeBaselines(
      Array.from({ length: 10 }, () => ({
        neighborhood: "Mission",
        bedrooms: 1,
        priceMonthly: 3000,
      })),
    );
    const flagged = assessListing(
      { ...clean, neighborhood: "Mission", priceMonthly: 1500 },
      baselines,
    );
    expect(flagged.warnings.join(" ")).toContain("price_far_below_baseline");
    const fine = assessListing(
      { ...clean, neighborhood: "Mission", priceMonthly: 2400 },
      baselines,
    );
    expect(fine.level).toBe("none");
  });

  it("flags classic wire-transfer and owner-abroad language", () => {
    const a = assessListing(
      {
        ...clean,
        description:
          "I am currently out of the country. Send deposit via wire transfer before viewing and I will mail the keys.",
      },
      null,
    );
    expect(a.level).toBe("verify_carefully");
    expect(a.warnings.join(" ")).toContain("suspicious_payment_language");
    expect(a.warnings.join(" ")).toContain("owner_unavailable_language");
  });

  it("treats a single weak signal as watch, several as verify_carefully", () => {
    const onePhotoless = assessListing({ ...clean, photoCount: 0 }, null);
    expect(onePhotoless.level).toBe("watch");
    const alsoNoLocation = assessListing(
      {
        ...clean,
        photoCount: 0,
        addressRaw: null,
        latitude: null,
        longitude: null,
        neighborhood: null,
      },
      null,
    );
    expect(alsoNoLocation.level).toBe("verify_carefully");
  });

  it("flags description reuse across neighborhoods", () => {
    const a = assessListing(
      { ...clean, descriptionSharedAcrossNeighborhoods: true },
      null,
    );
    expect(a.level).toBe("verify_carefully");
    expect(a.warnings.join(" ")).toContain("duplicate_description_across_neighborhoods");
  });
});
