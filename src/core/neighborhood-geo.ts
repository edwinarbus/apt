import hoodsData from "@/data/sf-neighborhoods.json";
import { pointInMultiPolygon, type MultiPolygonCoords } from "@/lib/geo";

/**
 * Reverse-geocode a coordinate to its SF neighborhood using the official
 * "SF Find Neighborhoods" planning polygons (the same 37 the map draws). This
 * is geographically authoritative but coarser than some sources' finer names
 * (it has no "Hayes Valley", "NoPa", "Tenderloin" — those fall inside their
 * parent district), so callers should use it to FILL a missing neighborhood,
 * never to override a good source-provided one.
 */

interface HoodFeature {
  properties: { name: string };
  geometry: { type: "MultiPolygon"; coordinates: MultiPolygonCoords };
}

const HOODS = (hoodsData as unknown as { features: HoodFeature[] }).features;

/** The neighborhood polygon containing (lng, lat), or null if outside SF. */
export function neighborhoodForPoint(lng: number, lat: number): string | null {
  for (const h of HOODS) {
    if (pointInMultiPolygon(lng, lat, h.geometry.coordinates)) {
      return h.properties.name;
    }
  }
  return null;
}
