import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nowIso } from "@/db/client";
import { geocodeCache } from "@/db/schema";
import type { GeocodePrecision } from "./types";
import { neighborhoodCentroid } from "./neighborhoods";

/**
 * Geocoding with a permanent cache: the same address is never geocoded twice.
 * Provider is Nominatim (OpenStreetMap) used at ≤1 req/1.1s with an
 * identifying User-Agent, per their usage policy — appropriate for a
 * personal, low-volume tool. Listings without a usable street address fall
 * back to their neighborhood centroid with precision "neighborhood".
 */

export interface GeocodeHit {
  latitude: number | null;
  longitude: number | null;
  precision: GeocodePrecision;
  formattedAddress: string | null;
  raw?: unknown;
}

export type GeocodeProvider = (address: string) => Promise<GeocodeHit | null>;

const NOMINATIM_UA =
  "apt-personal-apartment-scout/0.1 (personal non-commercial apartment search)";
// Rough SF bounding box keeps results inside the city.
const SF_VIEWBOX = "-122.55,37.85,-122.33,37.69";

let lastNominatimCall = 0;

const ORDINAL_WORDS: Record<string, string> = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
  sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  eleventh: "11th", twelfth: "12th", thirteenth: "13th", fourteenth: "14th",
  fifteenth: "15th", sixteenth: "16th", seventeenth: "17th", eighteenth: "18th",
  nineteenth: "19th", twentieth: "20th",
};

/**
 * Turn spelled-out ordinal street names into their digit form for geocoding:
 * SF has "Third Street", "Ninth Avenue", etc., but OpenStreetMap indexes them
 * as "3rd Street" / "9th Avenue" — the word form returns no result. Only the
 * geocoder query is normalized; the stored/display address is left as written.
 */
export function normalizeStreetOrdinals(address: string): string {
  return address.replace(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi,
    (m) => ORDINAL_WORDS[m.toLowerCase()] ?? m,
  );
}

export const nominatimProvider: GeocodeProvider = async (address) => {
  const wait = 1100 - (Date.now() - lastNominatimCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${normalizeStreetOrdinals(address)}, San Francisco, CA`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", SF_VIEWBOX);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
      addresstype?: string;
      type?: string;
      class?: string;
    }>;
    if (!results.length) return null;
    const hit = results[0];
    return {
      latitude: Number(hit.lat),
      longitude: Number(hit.lon),
      precision: precisionFromNominatim(hit.addresstype ?? hit.type ?? ""),
      formattedAddress: hit.display_name ?? null,
      raw: hit,
    };
  } catch {
    return null;
  }
};

function precisionFromNominatim(addressType: string): GeocodePrecision {
  switch (addressType) {
    case "house":
    case "house_number":
    case "address":
      return "exact_address";
    case "building":
    case "residential":
    case "apartments":
      return "building";
    case "road":
    case "street":
    case "block":
      return "block";
    case "neighbourhood":
    case "suburb":
    case "quarter":
      return "neighborhood";
    case "city":
    case "town":
    case "municipality":
      return "city";
    default:
      return "block";
  }
}

export function geocodeCacheKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GeocodeOutcome extends GeocodeHit {
  fromCache: boolean;
}

/**
 * Resolve an address through the cache, then the provider. Negative results
 * are cached too (as precision "unknown") so a bad address is not retried on
 * every ingest run.
 */
export async function geocodeAddress(
  db: Db,
  address: string,
  provider: GeocodeProvider = nominatimProvider,
): Promise<GeocodeOutcome | null> {
  const key = geocodeCacheKey(address);
  if (!key) return null;
  const cached = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.addressKey, key))
    .get();
  if (cached) {
    if (cached.latitude == null || cached.longitude == null) return null;
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      precision: cached.precision as GeocodePrecision,
      formattedAddress: cached.formattedAddress,
      fromCache: true,
    };
  }
  const hit = await provider(address);
  await db
    .insert(geocodeCache)
    .values({
      addressKey: key,
      latitude: hit?.latitude ?? null,
      longitude: hit?.longitude ?? null,
      precision: hit?.precision ?? "unknown",
      provider: "nominatim",
      formattedAddress: hit?.formattedAddress ?? null,
      raw: hit?.raw ?? null,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .run();
  if (!hit || hit.latitude == null || hit.longitude == null) return null;
  return { ...hit, fromCache: false };
}

/**
 * Neighborhood-centroid fallback for listings with no usable address.
 * Returns null when the neighborhood is unknown too.
 */
export function neighborhoodFallback(
  neighborhood: string | null | undefined,
): GeocodeHit | null {
  const centroid = neighborhoodCentroid(neighborhood);
  if (!centroid) return null;
  return {
    latitude: centroid.lat,
    longitude: centroid.lng,
    precision: "neighborhood",
    formattedAddress: null,
  };
}
