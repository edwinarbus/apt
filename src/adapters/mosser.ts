import { sha256Hex } from "@/core/hash";
import {
  extractConcessions,
  parseBathrooms,
  parseBedrooms,
  parsePrice,
  parseSquareFeet,
} from "@/core/normalize";
import { matchNeighborhood } from "@/core/neighborhoods";
import type { NormalizedListing } from "@/core/types";
import type { AdapterContext, AdapterRunResult, SourceAdapter } from "./types";
import { emptyRunResult } from "./types";

/**
 * Mosser Living adapter — a large SF property manager on a RentPress
 * (WordPress) stack.
 *
 * Data path (verified 2026-07-02, plain HTTP, no browser):
 *  1. GET /wp-json/wp/v2/city → find the "San Francisco" taxonomy term id.
 *  2. GET /wp-json/wp/v2/rentpress_property?city=<id>&per_page=100 → the ~60 SF
 *     property page links.
 *  3. Each property page embeds a complete `data-floorplans='[...]'` JSON blob
 *     in its raw HTML (the RentPress Vue app hydrates from it): per-floorplan
 *     rent/beds/baths/sqft/availability/photos plus the property's address,
 *     exact coordinates, city, neighborhood, amenities, pet policy, and
 *     contact info.
 *
 * Listings are at floorplan granularity — each available floorplan at an SF
 * property is one listing. The RentPress feed spans SF/Oakland/LA; the adapter
 * keeps San Francisco only (belt and suspenders: the city taxonomy filter AND
 * each blob's property_city).
 */

const CITY_PATH = "/wp-json/wp/v2/city";
const PROPERTY_LIST_PATH = "/wp-json/wp/v2/rentpress_property";

/** RentPress encodes absent values as the literal string "None". */
function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "None" || s === "null") return null;
  return s;
}

function parseJsonArray(raw: unknown): unknown[] {
  const s = clean(raw);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Extract the `data-floorplans` JSON blob (single-quoted, HTML-escaped) from a property page. */
export function extractFloorplansBlob(html: string): Record<string, string>[] {
  const m =
    html.match(/data-floorplans='(.*?)'/s) ??
    html.match(/data-floorplans="(.*?)"/s);
  if (!m) return [];
  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractPhotos(fp: Record<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: unknown) => {
    const s = clean(u);
    if (!s || !/^https?:\/\//.test(s)) return;
    const clean2 = s.split("?")[0];
    if (!seen.has(clean2)) {
      seen.add(clean2);
      out.push(clean2);
    }
  };
  for (const img of parseJsonArray(fp.floorplan_images)) {
    if (img && typeof img === "object" && "url" in img) push((img as { url: unknown }).url);
  }
  push(fp.floorplan_image);
  return out;
}

export function buildListingFromFloorplan(
  fp: Record<string, string>,
): NormalizedListing | null {
  // San Francisco only.
  if (!/^san francisco$/i.test((fp.property_city ?? "").trim())) return null;
  // Available floorplans only.
  const available =
    fp.floorplan_available === "1" || Number(fp.floorplan_units_available ?? "0") > 0;
  if (!available) return null;

  const propertyCode = clean(fp.property_code) ?? clean(fp.floorplan_parent_property_code);
  const floorplanCode = clean(fp.floorplan_code);
  if (!propertyCode || !floorplanCode) return null;
  const sourceListingId = `${propertyCode}-${floorplanCode}`;

  const originalUrl =
    clean(fp.floorplan_post_link) ?? clean(fp.property_post_link);
  if (!originalUrl) return null;

  const propertyName = clean(fp.property_name) ?? clean(fp.floorplan_parent_property_name);
  const floorplanName = clean(fp.floorplan_name);
  const address = clean(fp.property_address);

  const rent =
    parsePrice(clean(fp.floorplan_rent_best) ?? "") ??
    parsePrice(clean(fp.floorplan_rent_min) ?? "") ??
    parsePrice(clean(fp.floorplan_rent_base) ?? "");
  const concessionsRaw =
    clean(fp.floorplan_specials_message) ??
    extractConcessions(clean(fp.floorplan_description));

  const lat = fp.property_latitude ? Number(fp.property_latitude) : null;
  const lng = fp.property_longitude ? Number(fp.property_longitude) : null;
  const hasCoords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0;

  const beds = clean(fp.floorplan_bedrooms);
  const baths = clean(fp.floorplan_bathrooms);
  const sqft = clean(fp.floorplan_sqft_min) ?? clean(fp.floorplan_sqft_max);
  const deposit = parsePrice(clean(fp.floorplan_deposit_min) ?? "");

  const amenities = [
    ...parseJsonArray(fp.property_features),
    ...parseJsonArray(fp.property_community_amenities),
  ]
    .map((a) => (typeof a === "string" ? a.trim() : ""))
    .filter(Boolean);
  const petPolicyRaw = clean(fp.property_pet_policy);

  return {
    sourceListingId,
    originalUrl,
    title: [propertyName, floorplanName].filter(Boolean).join(" — ") ||
      `Mosser unit ${sourceListingId}`,
    fetchDepth: "detail",
    description: clean(fp.floorplan_description) ?? clean(fp.property_description),
    rawDescription: clean(fp.floorplan_description),
    propertyName,
    // Listings are floorplan-level, so the floorplan name is the unit
    // discriminator — without it, every distinct floorplan at one building
    // (studio, 1BR, 2BR…) would collapse together in dedupe by shared address.
    unitNumberPublic: floorplanName,
    addressRaw: address,
    neighborhood:
      matchNeighborhood(clean(fp.property_neighborhood_post_name))?.name ?? null,
    sourceNeighborhoodRaw: clean(fp.property_neighborhood_post_name),
    city: "San Francisco",
    state: clean(fp.property_state) ?? "CA",
    postalCode: clean(fp.property_zip),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lng : null,
    geocodePrecision: hasCoords ? "building" : null,
    priceRaw: clean(fp.floorplan_rent_best) ? `$${clean(fp.floorplan_rent_best)}` : null,
    priceMonthly: rent,
    concessionsRaw,
    depositRaw: clean(fp.floorplan_deposit_min) ? `$${clean(fp.floorplan_deposit_min)}` : null,
    depositAmount: deposit,
    bedroomsRaw: beds ?? floorplanName,
    bedrooms: beds != null && /^\d+(\.\d+)?$/.test(beds) ? Number(beds) : parseBedrooms(floorplanName),
    bathroomsRaw: baths,
    bathrooms: baths != null && /^\d+(\.\d+)?$/.test(baths) ? Number(baths) : parseBathrooms(baths ?? ""),
    squareFeetRaw: sqft ? `${sqft} sqft` : null,
    squareFeet: parseSquareFeet(sqft ? `${sqft} sqft` : null),
    propertyType: "apartment",
    listingType: "rent",
    photos: extractPhotos(fp),
    primaryPhotoUrl: extractPhotos(fp)[0] ?? null,
    amenitiesRaw: amenities,
    amenitiesNormalized: amenities.map((a) => a.toLowerCase()),
    petPolicyRaw,
    applicationUrl: clean(fp.floorplan_availability_url) ?? clean(fp.property_availability_url),
    contactPhone: clean(fp.property_phone_number),
    contactEmail: clean(fp.property_email),
    listingStatus: "active",
    rawPayload: { floorplan: { ...fp, floorplan_images: undefined, property_gallery_images: undefined } },
  };
}

interface CityTerm {
  id: number;
  name: string;
}
interface PropertyRef {
  link: string;
}

export const mosserAdapter: SourceAdapter = {
  adapterType: "mosser",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const baseUrl = ctx.source.baseUrl ?? "https://www.mosserliving.com";

    // 1. Discover the San Francisco city taxonomy term id.
    const cityRes = await ctx.fetcher.fetchText(`${baseUrl}${CITY_PATH}?per_page=100`, {
      headers: { Accept: "application/json" },
    });
    result.pagesVisited = 1;
    if (!cityRes.ok) {
      result.fatalError = `city taxonomy fetch failed: ${cityRes.error}`;
      return result;
    }
    let sfCityId: number | null = null;
    try {
      const cities = JSON.parse(cityRes.text) as CityTerm[];
      sfCityId =
        cities.find((c) => /^san francisco$/i.test((c.name ?? "").trim()))?.id ?? null;
    } catch (err) {
      result.fatalError = `could not parse city taxonomy: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    if (sfCityId == null) {
      result.fatalError = "no 'San Francisco' city term found — taxonomy may have changed";
      return result;
    }

    // 2. List SF property page links.
    const listUrl = `${baseUrl}${PROPERTY_LIST_PATH}?city=${sfCityId}&per_page=100&_fields=link`;
    const listRes = await ctx.fetcher.fetchText(listUrl, {
      headers: { Accept: "application/json" },
    });
    result.pagesVisited = 2;
    if (!listRes.ok) {
      result.fatalError = `SF property list fetch failed: ${listRes.error}`;
      return result;
    }
    let propertyLinks: string[];
    try {
      propertyLinks = (JSON.parse(listRes.text) as PropertyRef[])
        .map((p) => p.link)
        .filter((l): l is string => typeof l === "string");
    } catch (err) {
      result.fatalError = `could not parse SF property list: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    if (propertyLinks.length === 0) {
      result.fatalError = "SF property list is empty — taxonomy/structure may have changed";
      result.paginationCompleted = false;
      return result;
    }

    // 3. Fetch each SF property page and extract its floorplans blob.
    const budget = ctx.source.maxDetailPagesPerRun;
    const toFetch = propertyLinks.slice(0, budget);
    if (propertyLinks.length > toFetch.length) {
      result.warnings.push(
        `property budget exhausted: ${propertyLinks.length} SF properties, cap is ${budget}; missing-listing tracking will be blocked this run`,
      );
    }
    ctx.log(
      `mosser: ${propertyLinks.length} SF properties (city term ${sfCityId}), fetching ${toFetch.length} property pages`,
    );

    const bySourceId = new Map<string, NormalizedListing>();
    let propertyFailures = 0;
    let propertiesWithoutBlob = 0;
    for (const link of toFetch) {
      const res = await ctx.fetcher.fetchText(link);
      result.detailPagesVisited++;
      if (!res.ok) {
        propertyFailures++;
        result.warnings.push(`property page fetch failed for ${link}: ${res.error}`);
        continue;
      }
      const floorplans = extractFloorplansBlob(res.text);
      // A property with no availability legitimately has no floorplans blob;
      // only flag it if it happens across most properties (a real parse break).
      if (floorplans.length === 0) {
        propertiesWithoutBlob++;
        continue;
      }
      for (const fp of floorplans) {
        const listing = buildListingFromFloorplan(fp);
        // Dedupe: a floorplan can appear in more than one property page's blob.
        if (listing && !bySourceId.has(listing.sourceListingId)) {
          bySourceId.set(listing.sourceListingId, listing);
        }
      }
    }
    if (toFetch.length >= 8 && propertiesWithoutBlob > toFetch.length * 0.7) {
      result.warnings.push(
        `${propertiesWithoutBlob}/${toFetch.length} properties had no floorplans blob — parser may have broken (expected only for fully-occupied buildings)`,
      );
    }

    result.listings = [...bySourceId.values()];
    result.htmlHash = sha256Hex(listRes.text);
    result.detailFetchFailures = propertyFailures;
    result.totalListingsReportedBySource = null;
    // Complete only if we fetched every SF property page without failures.
    result.paginationCompleted =
      toFetch.length === propertyLinks.length && propertyFailures === 0;
    result.detailExtractionCompleted = propertyFailures === 0;
    result.pageTrace.push({
      page: 1,
      url: listUrl,
      httpStatus: listRes.status,
      listingsExtracted: result.listings.length,
      note: `${toFetch.length}/${propertyLinks.length} SF properties fetched, ${propertyFailures} failed`,
    });

    if (result.listings.length === 0) {
      result.fatalError =
        "zero available SF floorplans extracted — structure may have changed";
      result.paginationCompleted = false;
    }
    return result;
  },
};
