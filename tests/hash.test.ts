import { describe, expect, it } from "vitest";
import {
  contentHashFor,
  descriptionHashFor,
  photoHashFor,
  photoKey,
} from "@/core/hash";
import type { NormalizedListing } from "@/core/types";

const base: NormalizedListing = {
  sourceListingId: "x1",
  originalUrl: "https://example.com/1",
  title: "Sunny 1BR",
  fetchDepth: "detail",
  priceMonthly: 3000,
  bedrooms: 1,
  description: "A lovely apartment with lots of light and a nice kitchen.",
};

describe("photoKey", () => {
  it("strips craigslist size suffixes so variants collide", () => {
    const a = photoKey("https://images.craigslist.org/00606_5JRDerJOwpg_0co0gw_600x450.jpg");
    const b = photoKey("https://images.craigslist.org/00606_5JRDerJOwpg_0co0gw_50x50c.jpg");
    expect(a).toBe(b);
    expect(a).toContain("00606_5jrderjowpg_0co0gw");
  });
  it("keeps distinct images distinct", () => {
    expect(
      photoKey("https://images.craigslist.org/00606_aaa_600x450.jpg"),
    ).not.toBe(photoKey("https://images.craigslist.org/00606_bbb_600x450.jpg"));
  });
});

describe("photoHashFor", () => {
  it("is order-insensitive and null for empty", () => {
    const h1 = photoHashFor(["https://x.com/a.jpg", "https://x.com/b.jpg"]);
    const h2 = photoHashFor(["https://x.com/b.jpg", "https://x.com/a.jpg"]);
    expect(h1).toBe(h2);
    expect(photoHashFor([])).toBeNull();
    expect(photoHashFor(null)).toBeNull();
  });
});

describe("descriptionHashFor", () => {
  it("ignores case, punctuation and whitespace", () => {
    const a = descriptionHashFor("Bright & sunny!  Great light, hardwood floors everywhere.");
    const b = descriptionHashFor("bright   sunny great light HARDWOOD floors everywhere");
    expect(a).toBe(b);
  });
  it("returns null for very short text", () => {
    expect(descriptionHashFor("Nice place")).toBeNull();
    expect(descriptionHashFor(null)).toBeNull();
  });
});

describe("contentHashFor", () => {
  it("is stable for identical content", () => {
    expect(contentHashFor({ ...base })).toBe(contentHashFor({ ...base }));
  });
  it("changes when price changes", () => {
    expect(contentHashFor({ ...base, priceMonthly: 2900 })).not.toBe(
      contentHashFor(base),
    );
  });
  it("ignores photo size-variant churn", () => {
    const a = contentHashFor({
      ...base,
      photos: ["https://images.craigslist.org/00606_aaa_600x450.jpg"],
    });
    const b = contentHashFor({
      ...base,
      photos: ["https://images.craigslist.org/00606_aaa_50x50c.jpg"],
    });
    expect(a).toBe(b);
  });
});
