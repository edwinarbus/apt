import { describe, expect, it } from "vitest";
import {
  computeEffectiveMonthly,
  computePricePerSquareFoot,
  extractConcessions,
  htmlToText,
  normalizeAddressKey,
  normalizeLaundry,
  normalizeParking,
  parseBathrooms,
  parseBedrooms,
  parseLeaseTermMonths,
  parsePetPolicy,
  parsePrice,
  parseSquareFeet,
} from "@/core/normalize";

describe("parsePrice", () => {
  it("parses common formats", () => {
    expect(parsePrice("$2,995")).toBe(2995);
    expect(parsePrice("$1,795/month")).toBe(1795);
    expect(parsePrice("3200")).toBe(3200);
    expect(parsePrice("  $4,650 ")).toBe(4650);
  });
  it("rejects garbage and implausible values", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("call for price")).toBeNull();
    expect(parsePrice("$5")).toBeNull();
  });
});

describe("parseBedrooms / parseBathrooms", () => {
  it("handles studios and BR/Ba shorthand", () => {
    expect(parseBedrooms("Studio")).toBe(0);
    expect(parseBedrooms("0BR / 1Ba")).toBe(0);
    expect(parseBedrooms("1BR / 1Ba")).toBe(1);
    expect(parseBedrooms("2 Bedrooms")).toBe(2);
    expect(parseBedrooms("3 bd")).toBe(3);
    expect(parseBathrooms("1BR / 1.5Ba")).toBe(1.5);
    expect(parseBathrooms("2 Baths")).toBe(2);
  });
  it("returns null for unknown", () => {
    expect(parseBedrooms("spacious unit")).toBeNull();
    expect(parseBathrooms("shared bath")).toBeNull();
  });
});

describe("parseSquareFeet", () => {
  it("parses craigslist and plain formats", () => {
    expect(parseSquareFeet("650ft2")).toBe(650);
    expect(parseSquareFeet("273 sqft")).toBe(273);
    expect(parseSquareFeet("1,050 sq ft")).toBe(1050);
  });
  it("rejects implausible values", () => {
    expect(parseSquareFeet("20 sqft")).toBeNull();
    expect(parseSquareFeet(null)).toBeNull();
  });
});

describe("laundry / parking / pets", () => {
  it("normalizes laundry", () => {
    expect(normalizeLaundry("w/d in unit")).toBe("in_unit");
    expect(normalizeLaundry("laundry in bldg")).toBe("in_building");
    expect(normalizeLaundry("coin-op laundry room")).toBe("in_building");
    expect(normalizeLaundry("w/d hookups")).toBe("hookups");
    expect(normalizeLaundry("no laundry on site")).toBe("none");
    expect(normalizeLaundry("granite counters")).toBeNull();
  });
  it("normalizes parking", () => {
    expect(normalizeParking("attached garage")).toBe("garage");
    expect(normalizeParking("off-street parking")).toBe("off_street");
    expect(normalizeParking("street parking")).toBe("street");
    expect(normalizeParking("no parking")).toBe("none");
  });
  it("parses pet policy without inventing certainty", () => {
    expect(parsePetPolicy("cats are OK - purrr").catsAllowed).toBe(true);
    expect(parsePetPolicy("cats are OK - purrr").dogsAllowed).toBeNull();
    expect(parsePetPolicy("dogs are OK - wooof").dogsAllowed).toBe(true);
    const none = parsePetPolicy("no pets");
    expect(none.catsAllowed).toBe(false);
    expect(none.dogsAllowed).toBe(false);
    const small = parsePetPolicy("small dogs under 25 lbs welcome");
    expect(small.dogsAllowed).toBe(true);
    expect(small.dogRestrictionsRaw).toContain("small dogs");
    expect(parsePetPolicy(null).catsAllowed).toBeNull();
  });
});

describe("concessions", () => {
  it("extracts and amortizes free-rent offers over a 12-month term", () => {
    const text = "Move-in special: 6 weeks free on a 12-month lease!";
    const concession = extractConcessions(text);
    expect(concession).toContain("6 weeks free");
    // 6 weeks ≈ 1.38 months -> 4650 * (12 - 1.38) / 12 ≈ 4115
    expect(computeEffectiveMonthly(4650, concession)).toBe(4115);
    expect(computeEffectiveMonthly(3000, "1 month free")).toBe(2750);
    expect(computeEffectiveMonthly(3000, null)).toBeNull();
  });
});

describe("misc", () => {
  it("computes price per square foot", () => {
    expect(computePricePerSquareFoot(3400, 900)).toBe(3.78);
    expect(computePricePerSquareFoot(3400, null)).toBeNull();
  });
  it("normalizes address keys with unit and suffix unification", () => {
    expect(normalizeAddressKey("1301 18th Street", "2")).toBe("1301 18th st|2");
    expect(normalizeAddressKey("1301 18th St.", "#2")).toBe("1301 18th st|2");
    expect(normalizeAddressKey(null)).toBeNull();
  });
  it("strips html to text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>Bye</p>")).toBe("Hello world\nBye");
  });
  it("parses lease terms", () => {
    expect(parseLeaseTermMonths("12 month lease")).toBe(12);
    expect(parseLeaseTermMonths("month-to-month")).toBe(1);
    expect(parseLeaseTermMonths(null)).toBeNull();
  });
});
