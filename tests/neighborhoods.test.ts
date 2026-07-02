import { describe, expect, it } from "vitest";
import {
  isSfLocation,
  matchNeighborhood,
  neighborhoodCentroid,
} from "@/core/neighborhoods";

describe("matchNeighborhood", () => {
  it("maps craigslist combined hood names", () => {
    expect(matchNeighborhood("SOMA / south beach")?.name).toBe("SoMa");
    expect(matchNeighborhood("downtown / civic / van ness")?.name).toBe("Downtown");
    expect(matchNeighborhood("marina / cow hollow")?.name).toBe("Marina");
    expect(matchNeighborhood("alamo square / nopa")?.name).toBe("NoPa");
    expect(matchNeighborhood("USF / panhandle")?.name).toBe("NoPa");
    expect(matchNeighborhood("twin peaks / diamond hts")?.name).toBe("Twin Peaks");
  });
  it("prefers the most specific match", () => {
    expect(matchNeighborhood("lower nob hill")?.name).toBe("Lower Nob Hill");
    expect(matchNeighborhood("nob hill")?.name).toBe("Nob Hill");
    expect(matchNeighborhood("lower haight")?.name).toBe("Lower Haight");
    expect(matchNeighborhood("haight ashbury")?.name).toBe("Haight-Ashbury");
  });
  it("handles common aliases and casing", () => {
    expect(matchNeighborhood("Pac Heights")?.name).toBe("Pacific Heights");
    expect(matchNeighborhood("the mission")?.name).toBe("Mission");
    expect(matchNeighborhood("Fillmore")?.name).toBe("Western Addition");
  });
  it("returns null for unknown or city-level strings", () => {
    expect(matchNeighborhood("city of san francisco")).toBeNull();
    expect(matchNeighborhood("oakland lake merritt")).toBeNull();
    expect(matchNeighborhood(null)).toBeNull();
  });
});

describe("isSfLocation", () => {
  it("accepts SF neighborhoods and explicit SF", () => {
    expect(isSfLocation("tenderloin")).toBe(true);
    expect(isSfLocation("city of san francisco")).toBe(true);
    expect(isSfLocation("San Francisco")).toBe(true);
    expect(isSfLocation("inner sunset / UCSF")).toBe(true);
  });
  it("rejects nearby cities — including South San Francisco", () => {
    expect(isSfLocation("Oakland, CA")).toBe(false);
    expect(isSfLocation("south san francisco")).toBe(false);
    expect(isSfLocation("daly city")).toBe(false);
    expect(isSfLocation("berkeley north / hills")).toBe(false);
    expect(isSfLocation(null)).toBe(false);
  });
});

describe("neighborhoodCentroid", () => {
  it("returns coordinates for canonical names", () => {
    const c = neighborhoodCentroid("Lower Haight");
    expect(c?.lat).toBeCloseTo(37.772, 2);
    expect(c?.lng).toBeCloseTo(-122.43, 1);
    expect(neighborhoodCentroid("Atlantis")).toBeNull();
  });
});
