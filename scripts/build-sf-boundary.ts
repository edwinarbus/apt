import { writeFileSync } from "node:fs";
import { join } from "node:path";
import polygonClipping, { type Geom, type Polygon } from "polygon-clipping";
import hoods from "../src/data/sf-neighborhoods.json";

/**
 * Precompute the "outside San Francisco" mask geometry: a big bounding box
 * around the Bay Area MINUS every SF neighborhood, dissolved with a real
 * polygon-boolean so overlaps and winding are resolved cleanly. The runtime
 * map draws this single MultiPolygon opaque, so nothing outside SF is visible
 * and there are no red/dark seams inside SF (which a naive world-ring-with-
 * per-hood-holes mask produced because the hood polygons overlap).
 *
 *   npm run build:sf-boundary
 */

const features = (hoods as { features: { geometry: { coordinates: unknown } }[] }).features;
const polys = features.map((f) => f.geometry.coordinates as Geom);

// A generous rectangle covering everything the tilted SF map can ever show.
const box: Polygon = [
  [
    [-123.4, 37.2],
    [-121.6, 37.2],
    [-121.6, 38.4],
    [-123.4, 38.4],
    [-123.4, 37.2],
  ],
];

const outside = polygonClipping.difference(box, ...polys);

const out = { type: "MultiPolygon" as const, coordinates: outside };
const path = join(__dirname, "..", "src", "data", "sf-outside-mask.json");
writeFileSync(path, JSON.stringify(out));
console.log(
  `Wrote ${path} — ${outside.length} polygon(s), ` +
    `${outside.reduce((n, p) => n + p.length, 0)} ring(s).`,
);
