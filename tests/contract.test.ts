import { describe, expect, it } from "vitest";
import { validateAdapterResult } from "@/core/contract";
import { emptyRunResult } from "@/adapters/types";
import { makeListing } from "./helpers";

function resultWith(listings: ReturnType<typeof makeListing>[]) {
  return { ...emptyRunResult(), listings };
}

describe("validateAdapterResult", () => {
  it("passes a clean result and reports coverage stats", () => {
    const report = validateAdapterResult(
      resultWith([
        makeListing({ sourceListingId: "a1" }),
        makeListing({ sourceListingId: "a2" }),
      ]),
    );
    expect(report.ok).toBe(true);
    expect(report.stats.total).toBe(2);
    expect(report.stats.withOriginalUrl).toBe(2);
    expect(report.stats.withPrice).toBe(2);
    expect(report.stats.withLocation).toBe(2);
    expect(report.issues).toHaveLength(0);
  });

  it("errors on duplicate source listing ids in one run", () => {
    const report = validateAdapterResult(
      resultWith([
        makeListing({ sourceListingId: "same" }),
        makeListing({ sourceListingId: "same" }),
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("duplicate_source_listing_id");
    // Same id implies same fixture URL here, so the URL check fires too.
    expect(report.issues.map((i) => i.code)).toContain("duplicate_original_url");
  });

  it("errors on duplicate canonicalized original URLs", () => {
    const report = validateAdapterResult(
      resultWith([
        makeListing({
          sourceListingId: "a1",
          originalUrl: "https://x.com/l/1?utm_source=a",
        }),
        makeListing({ sourceListingId: "a2", originalUrl: "https://x.com/l/1/" }),
      ]),
    );
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("duplicate_original_url");
  });

  it("errors on missing URLs and titles", () => {
    const bad = makeListing({ sourceListingId: "a1" });
    bad.originalUrl = "not-a-url";
    bad.title = "";
    const report = validateAdapterResult(resultWith([bad]));
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("missing_original_url");
    expect(codes).toContain("missing_title");
    expect(report.ok).toBe(false);
  });

  it("warns (not errors) on low price and location coverage", () => {
    const listings = Array.from({ length: 10 }, (_, i) => {
      const l = makeListing({ sourceListingId: `a${i}` });
      l.priceMonthly = null;
      l.priceRaw = "call for price";
      l.neighborhood = null;
      l.latitude = null;
      l.longitude = null;
      return l;
    });
    const report = validateAdapterResult(resultWith(listings));
    expect(report.ok).toBe(true); // warnings only
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("low_price_coverage");
    expect(codes).toContain("price_parse_failures");
    expect(codes).toContain("low_location_coverage");
  });
});
