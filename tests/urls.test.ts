import { describe, expect, it } from "vitest";
import { canonicalizeListingUrl } from "@/core/urls";

describe("canonicalizeListingUrl", () => {
  it("strips tracking params but keeps identifying ones", () => {
    expect(
      canonicalizeListingUrl(
        "https://example.com/listing/123?utm_source=share&utm_medium=web&id=987&fbclid=abc",
      ),
    ).toBe("https://example.com/listing/123?id=987");
  });

  it("normalizes trailing slashes, ports, casing and fragments", () => {
    expect(
      canonicalizeListingUrl("https://Example.COM:443/listing/abc/#photos"),
    ).toBe("https://example.com/listing/abc");
    expect(canonicalizeListingUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("sorts query params so param order does not matter", () => {
    expect(canonicalizeListingUrl("https://x.com/l?b=2&a=1")).toBe(
      canonicalizeListingUrl("https://x.com/l?a=1&b=2"),
    );
  });

  it("does NOT merge distinct listings addressed by query params", () => {
    expect(canonicalizeListingUrl("https://x.com/l?id=1")).not.toBe(
      canonicalizeListingUrl("https://x.com/l?id=2"),
    );
  });

  it("canonicalizes real source urls stably", () => {
    const cl = canonicalizeListingUrl(
      "https://www.craigslist.org/view/d/san-francisco-cozy-studio/xciCPpdbkiM1UZfC8eD12X/",
    );
    expect(cl).toBe(
      "https://www.craigslist.org/view/d/san-francisco-cozy-studio/xciCPpdbkiM1UZfC8eD12X",
    );
    expect(
      canonicalizeListingUrl("https://www.rentsfnow.com/apartments/rental/650-ellis-28"),
    ).toBe("https://www.rentsfnow.com/apartments/rental/650-ellis-28");
  });

  it("returns null for garbage", () => {
    expect(canonicalizeListingUrl("not a url")).toBeNull();
    expect(canonicalizeListingUrl("mailto:x@y.com")).toBeNull();
  });
});
