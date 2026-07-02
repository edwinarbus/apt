/**
 * Tiny geo helpers for the neighborhood layer — dependency-free so both the
 * map UI and tests can use them.
 */

export type LngLat = [number, number];
export type Ring = LngLat[];
/** GeoJSON MultiPolygon coordinates: polygons → rings (first = outer, rest = holes). */
export type MultiPolygonCoords = Ring[][];

/** Ray-cast point-in-ring (lng/lat order, matching GeoJSON). */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point falls inside the MultiPolygon (outer rings minus holes). */
export function pointInMultiPolygon(
  lng: number,
  lat: number,
  coords: MultiPolygonCoords,
): boolean {
  for (const polygon of coords) {
    if (polygon.length === 0) continue;
    if (!inRing(lng, lat, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) {
      if (inRing(lng, lat, polygon[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** [[west, south], [east, north]] bounds of a MultiPolygon. */
export function multiPolygonBounds(
  coords: MultiPolygonCoords,
): [[number, number], [number, number]] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const polygon of coords) {
    for (const [lng, lat] of polygon[0] ?? []) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [
    [w, s],
    [e, n],
  ];
}
