import { describe, expect, it } from "vitest";
import { characteristicTags, type DislikeFacts } from "@/memory/characteristics";
import { curateMatches, inferAversions, MIN_DISLIKES_TO_CURATE } from "@/memory/curate";

function facts(over: Partial<DislikeFacts> = {}): DislikeFacts {
  return {
    title: null,
    addressRaw: null,
    bedrooms: 1,
    bathrooms: 1,
    priceMonthly: 3200,
    neighborhood: "Mission",
    parking: null,
    laundry: null,
    catsAllowed: null,
    dogsAllowed: null,
    squareFeet: null,
    propertyType: null,
    visualTags: [],
    description: null,
    ...over,
  };
}

describe("characteristicTags", () => {
  it("captures basic characteristics, incl. flooring from vision/description", () => {
    const tags = characteristicTags(
      facts({ bedrooms: 1, priceMonthly: 3200, neighborhood: "Mission", visualTags: ["carpeted flooring"] }),
    );
    expect(tags).toContain("flooring:carpet");
    expect(tags).toContain("price:3k-4k");
    expect(tags).toContain("beds:1");
    expect(tags).toContain("hood:mission");
  });

  it("reads flooring from the description too", () => {
    expect(characteristicTags(facts({ description: "Cozy unit, wall-to-wall carpet." }))).toContain(
      "flooring:carpet",
    );
    expect(characteristicTags(facts({ visualTags: ["hardwood floors"] }))).toContain(
      "flooring:hardwood",
    );
  });

  it("uses studio for zero bedrooms and omits unknowns", () => {
    const tags = characteristicTags(
      facts({ bedrooms: 0, neighborhood: null, priceMonthly: null, parking: "unknown" }),
    );
    expect(tags).toContain("beds:studio");
    expect(tags.some((t) => t.startsWith("hood:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("price:"))).toBe(false);
    expect(tags.some((t) => t.startsWith("parking:"))).toBe(false);
  });
});

describe("inferAversions", () => {
  it("stays quiet below the dislike threshold", () => {
    const sets = Array.from({ length: MIN_DISLIKES_TO_CURATE - 1 }, () => ["flooring:carpet"]);
    expect(inferAversions(sets)).toEqual([]);
  });

  it("infers a recurring characteristic (three carpeted apartments → carpet)", () => {
    const sets = [
      characteristicTags(facts({ neighborhood: "Mission", priceMonthly: 3200, visualTags: ["carpet"] })),
      characteristicTags(facts({ neighborhood: "SoMa", priceMonthly: 4100, visualTags: ["carpeted"] })),
      characteristicTags(facts({ neighborhood: "Sunset", priceMonthly: 2800, visualTags: ["carpeting"] })),
    ];
    const aversions = inferAversions(sets);
    const carpet = aversions.find((a) => a.tag === "flooring:carpet");
    expect(carpet).toBeDefined();
    expect(carpet!.count).toBe(3);
    expect(carpet!.strength).toBe(1);
  });

  it("ignores one-off traits (not shared across dislikes)", () => {
    const sets = [
      ["flooring:carpet", "hood:mission"],
      ["flooring:carpet", "hood:soma"],
      ["flooring:carpet", "hood:sunset"],
    ];
    const aversions = inferAversions(sets);
    expect(aversions.map((a) => a.tag)).toContain("flooring:carpet");
    expect(aversions.map((a) => a.tag)).not.toContain("hood:mission");
  });
});

describe("curateMatches", () => {
  const aversions = inferAversions([
    ["flooring:carpet"],
    ["flooring:carpet"],
    ["flooring:carpet"],
  ]);

  it("drops candidates that hit a strong recurring aversion", () => {
    const items = [
      { item: "carpet-a", tags: ["flooring:carpet", "beds:1"] },
      { item: "hardwood-b", tags: ["flooring:hardwood", "beds:1"] },
      { item: "carpet-c", tags: ["flooring:carpet"] },
    ];
    const { kept, removed } = curateMatches(items, aversions);
    expect(kept).toEqual(["hardwood-b"]);
    expect(removed).toBe(2);
  });

  it("is a no-op when there are no aversions", () => {
    const items = [
      { item: "a", tags: ["flooring:carpet"] },
      { item: "b", tags: ["flooring:hardwood"] },
    ];
    const { kept, removed } = curateMatches(items, []);
    expect(kept).toEqual(["a", "b"]);
    expect(removed).toBe(0);
  });

  it("never curates the whole list to nothing", () => {
    const items = [
      { item: "a", tags: ["flooring:carpet"] },
      { item: "b", tags: ["flooring:carpet"] },
    ];
    const { kept } = curateMatches(items, aversions);
    expect(kept.length).toBe(2);
  });
});
