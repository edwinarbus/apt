import fs from "node:fs";
import path from "node:path";

/**
 * One-shot generator for src/data/sf-neighborhoods.json — the 3D neighborhood
 * boundaries drawn on the map.
 *
 * Source: SF's public "SF Find Neighborhoods" planning polygons (37 hoods),
 * via the click_that_hood mirror (public data; the DataSF portal strips
 * geometry on anonymous API reads). We simplify aggressively for the web:
 * Douglas-Peucker at ~11m tolerance + 5-decimal rounding, which cuts ~550KB
 * to well under 100KB with no visible change at city zooms.
 *
 *   npx tsx scripts/build-neighborhoods.ts [path-to-raw-geojson]
 *
 * Re-run only if the source data or name mapping changes; the output is
 * checked in.
 */

const SOURCE_URL =
  "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/san-francisco.geojson";

/** Dataset name → the canonical name used across this app (src/core/neighborhoods.ts). */
const NAME_MAP: Record<string, string> = {
  "Castro/Upper Market": "Castro",
  "Downtown/Civic Center": "Downtown",
  "Haight Ashbury": "Haight-Ashbury",
  "South of Market": "SoMa",
  "Treasure Island/YBI": "Treasure Island",
};

type Ring = [number, number][];

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cl = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + cl * dx), p[1] - (a[1] + cl * dy));
}

function douglasPeucker(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  let maxDist = 0;
  let index = 0;
  const end = ring.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(ring[i], ring[0], ring[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(ring.slice(0, index + 1), tolerance);
    const right = douglasPeucker(ring.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [ring[0], ring[end]];
}

function simplifyRing(ring: Ring, tolerance: number): Ring {
  const simplified = douglasPeucker(ring, tolerance).map(
    ([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))] as [number, number],
  );
  // Ensure closure after rounding.
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([first[0], first[1]]);
  return simplified;
}

async function main() {
  const TOLERANCE = 0.0001; // ~11 m
  const localPath = process.argv[2];
  let raw: string;
  if (localPath) {
    raw = fs.readFileSync(localPath, "utf8");
  } else {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    raw = await res.text();
  }
  const src = JSON.parse(raw) as GeoJSON.FeatureCollection;

  let before = 0;
  let after = 0;
  const features = src.features
    .filter((f) => f.geometry?.type === "MultiPolygon")
    .map((f) => {
      const rawName = String(f.properties?.name ?? "?");
      const name = NAME_MAP[rawName] ?? rawName;
      const mp = f.geometry as GeoJSON.MultiPolygon;
      const coordinates = mp.coordinates
        .map((poly) =>
          poly
            .map((ring) => {
              before += ring.length;
              const s = simplifyRing(ring as Ring, TOLERANCE);
              after += s.length;
              return s;
            })
            // Drop rings that collapsed to less than a closed triangle.
            .filter((ring) => ring.length >= 4),
        )
        // Drop polygons whose outer ring collapsed entirely.
        .filter((poly) => poly.length > 0);
      return {
        type: "Feature" as const,
        properties: { name },
        geometry: { type: "MultiPolygon" as const, coordinates },
      };
    })
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

  const out = { type: "FeatureCollection" as const, features };
  const outPath = path.join(process.cwd(), "src", "data", "sf-neighborhoods.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(
    `wrote ${outPath}: ${features.length} neighborhoods, ${before} → ${after} vertices, ${kb} KB`,
  );
  console.log(features.map((f) => f.properties.name).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
