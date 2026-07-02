import { describe, expect, it } from "vitest";
import { matchesVisualQuery, parseVisualQuery } from "@/lib/visual-search";

const TEXT =
  "hardwood floors bay windows stainless steel appliances bright living room with a renovated kitchen and a claw-foot tub in the bathroom";

describe("parseVisualQuery", () => {
  it("splits on 'and', commas, ampersands, and 'with'", () => {
    expect(parseVisualQuery("hardwood floors and bay windows")).toEqual([
      "hardwood floors",
      "bay windows",
    ]);
    expect(parseVisualQuery("hardwood floors, bay windows")).toEqual([
      "hardwood floors",
      "bay windows",
    ]);
    expect(parseVisualQuery("kitchen with dishwasher")).toEqual(["kitchen", "dishwasher"]);
  });
  it("returns [] for an empty query", () => {
    expect(parseVisualQuery("   ")).toEqual([]);
  });
});

describe("matchesVisualQuery", () => {
  it("an empty query matches anything, even un-analyzed listings", () => {
    expect(matchesVisualQuery(null, "")).toBe(true);
    expect(matchesVisualQuery(TEXT, "  ")).toBe(true);
  });

  it("requires every phrase to be present (AND semantics)", () => {
    expect(matchesVisualQuery(TEXT, "hardwood floors and bay windows")).toBe(true);
    expect(matchesVisualQuery(TEXT, "hardwood floors, bay windows")).toBe(true);
    // one phrase missing → no match
    expect(matchesVisualQuery(TEXT, "hardwood floors and a fireplace")).toBe(false);
  });

  it("matches a single feature as a substring, case-insensitively", () => {
    expect(matchesVisualQuery(TEXT, "Stainless Steel Appliances")).toBe(true);
    expect(matchesVisualQuery(TEXT, "dishwasher")).toBe(false);
  });

  it("falls back to all-words-present for loose multi-word phrases", () => {
    // not a contiguous substring, but every significant word appears
    expect(matchesVisualQuery(TEXT, "hardwood bay window")).toBe(true);
  });

  it("never matches a listing without vision text when the query is non-empty", () => {
    expect(matchesVisualQuery(null, "hardwood floors")).toBe(false);
    expect(matchesVisualQuery("", "hardwood floors")).toBe(false);
  });
});
