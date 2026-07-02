import { describe, expect, it } from "vitest";
import { detectDuplicates, type DupeCandidate } from "@/core/dedupe";
import { descriptionHashFor } from "@/core/hash";

const cand = (over: Partial<DupeCandidate> & { id: string }): DupeCandidate => ({
  sourceId: "src_a",
  title: null,
  priceMonthly: null,
  neighborhood: null,
  addressRaw: null,
  addressNormalized: null,
  unitNumberPublic: null,
  photos: null,
  descriptionHash: null,
  ...over,
});

describe("detectDuplicates", () => {
  it("links listings sharing a normalized address + unit", () => {
    const r = detectDuplicates([
      cand({ id: "a", addressRaw: "1301 18th Street", unitNumberPublic: "2" }),
      cand({ id: "b", addressRaw: "1301 18th St.", unitNumberPublic: "#2" }),
      cand({ id: "c", addressRaw: "999 Valencia St" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].memberIds).toEqual(["a", "b"]);
    expect(r.groups[0].reasons).toContain("same_address_unit");
  });

  it("links reposts sharing photos within a source", () => {
    const r = detectDuplicates([
      cand({ id: "a", photos: ["https://images.craigslist.org/00E_aaa_600x450.jpg"] }),
      cand({ id: "b", photos: ["https://images.craigslist.org/00E_aaa_50x50c.jpg"] }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].reasons).toContain("same_photo_hash");
  });

  it("does not merge different units of one building that share building photos", () => {
    const buildingShots = [
      "https://cdn.example.com/580-ofarrell-lobby.jpg",
      "https://cdn.example.com/580-ofarrell-roof.jpg",
    ];
    const r = detectDuplicates([
      cand({ id: "a", unitNumberPublic: "206", photos: buildingShots }),
      cand({ id: "b", unitNumberPublic: "211", photos: buildingShots }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  it("does not merge different units sharing per-building boilerplate descriptions", () => {
    const desc = descriptionHashFor(
      "Welcome to 580 O'Farrell, a classic building in the heart of the city with a roof deck and shared laundry.",
    );
    const r = detectDuplicates([
      cand({ id: "a", unitNumberPublic: "206", descriptionHash: desc }),
      cand({ id: "b", unitNumberPublic: "211", descriptionHash: desc }),
    ]);
    expect(r.groups).toHaveLength(0);
    // …but a unit-less repost with the same description still links.
    const r2 = detectDuplicates([
      cand({ id: "a", unitNumberPublic: "206", descriptionHash: desc }),
      cand({ id: "c", unitNumberPublic: null, descriptionHash: desc }),
    ]);
    expect(r2.groups).toHaveLength(1);
  });

  it("does not link identical photo paths across different sources", () => {
    const r = detectDuplicates([
      cand({ id: "a", sourceId: "src_a", photos: ["https://cdn.example.com/x.jpg"] }),
      cand({ id: "b", sourceId: "src_b", photos: ["https://cdn.example.com/x.jpg"] }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  it("links same title+price+neighborhood and same description", () => {
    const desc = descriptionHashFor(
      "Beautiful remodeled unit with brand new appliances and amazing light throughout the day.",
    );
    const r = detectDuplicates([
      cand({ id: "a", title: "Sunny remodeled 1BR", priceMonthly: 3000, neighborhood: "Mission" }),
      cand({ id: "b", title: "Sunny Remodeled 1BR!", priceMonthly: 3000, neighborhood: "Mission" }),
      cand({ id: "c", descriptionHash: desc }),
      cand({ id: "d", descriptionHash: desc }),
    ]);
    expect(r.groups).toHaveLength(2);
    const reasons = r.groups.flatMap((g) => g.reasons);
    expect(reasons).toContain("similar_title_price_neighborhood");
    expect(reasons).toContain("same_description_hash");
  });

  it("surfaces cross-neighborhood description reuse as a scam signal", () => {
    const desc = descriptionHashFor(
      "Beautiful remodeled unit with brand new appliances and amazing light throughout the day.",
    );
    const r = detectDuplicates([
      cand({ id: "a", descriptionHash: desc, neighborhood: "Mission" }),
      cand({ id: "b", descriptionHash: desc, neighborhood: "Marina" }),
    ]);
    expect(r.crossNeighborhoodDescriptionIds.has("a")).toBe(true);
    expect(r.crossNeighborhoodDescriptionIds.has("b")).toBe(true);
  });

  it("assigns stable group ids for stable membership", () => {
    const input = [
      cand({ id: "a", addressRaw: "12 Page St", unitNumberPublic: "1" }),
      cand({ id: "b", addressRaw: "12 Page Street", unitNumberPublic: "1" }),
    ];
    expect(detectDuplicates(input).groups[0].id).toBe(
      detectDuplicates(input).groups[0].id,
    );
  });

  it("links same canonical original URL as exact confidence", () => {
    const r = detectDuplicates([
      cand({ id: "a", originalUrl: "https://x.com/listing/9?utm_source=email" }),
      cand({ id: "b", originalUrl: "https://x.com/listing/9/" }),
      cand({ id: "c", originalUrl: "https://x.com/listing/10" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].memberIds).toEqual(["a", "b"]);
    expect(r.groups[0].confidence).toBe("exact");
    expect(r.groups[0].reasons).toContain("same_canonical_url");
  });

  it("links same address + price + beds + baths as high confidence", () => {
    const r = detectDuplicates([
      cand({ id: "a", addressRaw: "740 Clayton St", priceMonthly: 3000, bedrooms: 1, bathrooms: 1 }),
      cand({ id: "b", addressRaw: "740 Clayton Street", priceMonthly: 3000, bedrooms: 1, bathrooms: 1, sourceId: "src_b" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].confidence).toBe("high");
    expect(r.groups[0].reasons).toContain("same_address_price_beds_baths");
  });

  it("does NOT link address+specs when unit numbers explicitly differ", () => {
    const r = detectDuplicates([
      cand({ id: "a", addressRaw: "1008 Larkin St", unitNumberPublic: "205", priceMonthly: 1595, bedrooms: 0, bathrooms: 1 }),
      cand({ id: "b", addressRaw: "1008 Larkin St", unitNumberPublic: "301", priceMonthly: 1595, bedrooms: 0, bathrooms: 1 }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  it("assigns confidence tiers by strongest signal", () => {
    const low = detectDuplicates([
      cand({ id: "a", title: "Sunny remodeled 1BR", priceMonthly: 3000, neighborhood: "Mission" }),
      cand({ id: "b", title: "Sunny Remodeled 1BR!", priceMonthly: 3000, neighborhood: "Mission" }),
    ]);
    expect(low.groups[0].confidence).toBe("low");
    const medium = detectDuplicates([
      cand({ id: "a", photos: ["https://images.craigslist.org/00E_x_600x450.jpg"] }),
      cand({ id: "b", photos: ["https://images.craigslist.org/00E_x_600x450.jpg"] }),
    ]);
    expect(medium.groups[0].confidence).toBe("medium");
  });

  it("tags same-source photo/description matches with different ids as repost candidates", () => {
    const r = detectDuplicates([
      cand({
        id: "a", sourceListingId: "111",
        photos: ["https://images.craigslist.org/00E_repost_600x450.jpg"],
      }),
      cand({
        id: "b", sourceListingId: "222",
        photos: ["https://images.craigslist.org/00E_repost_600x450.jpg"],
      }),
    ]);
    expect(r.groups[0].reasons).toContain("repost_candidate");
  });

  it("does not chain a PM portfolio into a mega-group via shared boilerplate", () => {
    // One property manager: same description everywhere, units only in titles.
    const boilerplate = descriptionHashFor(
      "Professionally managed apartment home with modern finishes, in-unit laundry, and responsive on-site maintenance. Contact us today to schedule a tour of this wonderful home.",
    );
    const r = detectDuplicates([
      // True repost pair: same building+unit posted twice with different titles.
      cand({ id: "a1", title: "1520 Gough St - 304", addressRaw: "1520 Gough St", descriptionHash: boilerplate, priceMonthly: 3995, bedrooms: 0, bathrooms: 1 }),
      cand({ id: "a2", title: "Bright Studio w/ Views! Unit #304", addressRaw: "1520 Gough Street", descriptionHash: boilerplate, priceMonthly: 3995, bedrooms: 0, bathrooms: 1 }),
      // Different unit in the same building: must NOT join.
      cand({ id: "b", title: "1520 Gough Street - 206", addressRaw: "1520 Gough St", descriptionHash: boilerplate, priceMonthly: 4595, bedrooms: 1, bathrooms: 1 }),
      // Different building entirely: must NOT join either.
      cand({ id: "c", title: "1040 Ashbury - Renovated 2BR", addressRaw: "1040 Ashbury St", descriptionHash: boilerplate, priceMonthly: 8100, bedrooms: 2, bathrooms: 2 }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].memberIds).toEqual(["a1", "a2"]);
  });

  it("picks an active, freshest primary listing", () => {
    const r = detectDuplicates([
      cand({
        id: "old", addressRaw: "12 Page St", unitNumberPublic: "1",
        staleStatus: "missing_once", listingStatus: "active",
        lastSeenAt: "2026-06-01T00:00:00Z", firstSeenAt: "2026-05-01T00:00:00Z",
      }),
      cand({
        id: "fresh", addressRaw: "12 Page Street", unitNumberPublic: "1",
        staleStatus: "active", listingStatus: "active",
        lastSeenAt: "2026-07-01T00:00:00Z", firstSeenAt: "2026-06-20T00:00:00Z",
        detailFetchedAt: "2026-07-01T00:00:00Z",
      }),
    ]);
    expect(r.groups[0].primaryListingId).toBe("fresh");
  });
});
