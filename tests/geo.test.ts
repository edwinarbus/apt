import { describe, expect, it } from "vitest";
import {
  multiPolygonBounds,
  pointInMultiPolygon,
  type MultiPolygonCoords,
} from "@/lib/geo";
import hoods from "@/data/sf-neighborhoods.json";

const fc = hoods as GeoJSON.FeatureCollection;
const polyOf = (name: string): MultiPolygonCoords => {
  const f = fc.features.find((x) => (x.properties as { name: string }).name === name);
  expect(f, `polygon for ${name}`).toBeTruthy();
  return (f!.geometry as GeoJSON.MultiPolygon).coordinates as MultiPolygonCoords;
};

describe("pointInMultiPolygon", () => {
  it("handles a simple square with a hole", () => {
    const square: MultiPolygonCoords = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    ];
    expect(pointInMultiPolygon(2, 2, square)).toBe(true);
    expect(pointInMultiPolygon(5, 5, square)).toBe(false); // in the hole
    expect(pointInMultiPolygon(11, 5, square)).toBe(false);
  });
});

describe("sf-neighborhoods data", () => {
  it("ships the 37 planning neighborhoods with closed rings", () => {
    expect(fc.features).toHaveLength(37);
    for (const f of fc.features) {
      const mp = f.geometry as GeoJSON.MultiPolygon;
      expect(mp.type).toBe("MultiPolygon");
      for (const poly of mp.coordinates) {
        for (const ring of poly) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
        }
      }
    }
  });

  it("contains known SF landmarks in the right neighborhoods", () => {
    // Chestnut & Fillmore → Marina
    expect(pointInMultiPolygon(-122.436, 37.8009, polyOf("Marina"))).toBe(true);
    // 24th & Mission BART → Mission
    expect(pointInMultiPolygon(-122.4184, 37.7522, polyOf("Mission"))).toBe(true);
    // Ferry Building → Financial District
    expect(pointInMultiPolygon(-122.3937, 37.7955, polyOf("Financial District"))).toBe(true);
    // Marina landmark is NOT in the Mission
    expect(pointInMultiPolygon(-122.436, 37.8009, polyOf("Mission"))).toBe(false);
  });

  it("computes sane bounds (Marina hugs the northern waterfront)", () => {
    const [[w, s], [e, n]] = multiPolygonBounds(polyOf("Marina"));
    expect(w).toBeGreaterThan(-122.46);
    expect(e).toBeLessThan(-122.41);
    expect(s).toBeGreaterThan(37.78);
    expect(n).toBeLessThan(37.82);
  });
});
