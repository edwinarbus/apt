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
    expect(r.groups[0].reasons).toContain("shared_photos");
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
    expect(reasons).toContain("same_title_price_neighborhood");
    expect(reasons).toContain("same_description");
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
});
