import { sha256Hex } from "@/core/hash";
import {
  computeEffectiveMonthly,
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
 * Brick + Timber adapter (rentbt.com) — an SF property manager.
 *
 * The browse page is a JavaScript-rendered WordPress + RentCafe app, but it is
 * driven by a clean public WordPress REST endpoint,
 * `/wp-json/property-search/v1/data/`, which returns every available unit as
 * structured JSON in a single request. Fetching that directly is far more
 * polite and reliable than rendering the page in a browser — one GET yields
 * price, beds/baths/sqft, unit, building address, exact coordinates,
 * neighborhood, amenities, concessions, the full photo gallery, and the
 * application URL. So this adapter needs no browser and no detail pages.
 *
 * The feed includes some East Bay (Berkeley) inventory; the adapter filters to
 * San Francisco using each unit's building city.
 */

const API_PATH = "/wp-json/property-search/v1/data/";

interface BtProperty {
  propertyId: string;
  propertyName: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  latitude: string;
  longitude: string;
  neighborhood: string;
  amenity: string;
}

interface BtApartment {
  id: string;
  propertyId: string;
  propertyName: string;
  floorplanName: string;
  floorplanId: string;
  apartmentName: string;
  apartmentId: string;
  beds: string;
  baths: string;
  minrent: string;
  maxrent: string;
  sqft: string;
  amenity: string;
  specials: string;
  apartmentImages: string;
  applyOnlineURL: string;
  description: string;
}

export interface BtApiResponse {
  properties: BtProperty[];
  apartments: BtApartment[];
}

function splitAmenities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[~^]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function parseApartmentImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ imageURL?: string }>;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const img of parsed) {
      if (!img.imageURL) continue;
      const clean = img.imageURL.split("?")[0];
      if (!seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Join an apartment to its building and produce a normalized listing, or null if not SF. */
export function buildListingFromApi(
  apt: BtApartment,
  property: BtProperty | undefined,
  baseUrl: string,
): NormalizedListing | null {
  // Filter to San Francisco by the building's city (feed includes East Bay).
  const city = property?.city ?? "";
  if (!/^san francisco$/i.test(city.trim())) return null;

  // The site addresses detail pages as /listing/<propertyId>-<apartmentId>
  // (apartmentId, NOT the feed's internal `id`).
  const sourceListingId = `${apt.propertyId}-${apt.apartmentId}`;
  const address = property?.address ?? apt.propertyName ?? null;
  const unit = apt.apartmentName?.trim() || null;
  const priceMonthly = parsePrice(apt.minrent) ?? parsePrice(apt.maxrent);
  const concessionsRaw = apt.specials?.trim() || null;
  const photos = parseApartmentImages(apt.apartmentImages);
  const amenities = [
    ...splitAmenities(apt.amenity),
    ...splitAmenities(property?.amenity),
  ];
  const amenityText = amenities.join(" ").toLowerCase();
  const petFriendly = /pet friendly/.test(amenityText);

  const lat = property?.latitude ? Number(property.latitude) : null;
  const lng = property?.longitude ? Number(property.longitude) : null;
  const hasCoords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  // The feed gives beds/baths as plain integers ("0" = studio); fall back to
  // the floorplan name ("1 Bedroom 1 Bath") when they're absent.
  const bedsNum = /^\d+(\.\d+)?$/.test((apt.beds ?? "").trim())
    ? Number(apt.beds)
    : parseBedrooms(apt.floorplanName);
  const bathsNum = /^\d+(\.\d+)?$/.test((apt.baths ?? "").trim())
    ? Number(apt.baths)
    : parseBathrooms(apt.floorplanName);

  return {
    sourceListingId,
    originalUrl: `${baseUrl}/listing/${sourceListingId}`,
    title: address ? `${address}${unit ? ` #${unit}` : ""}` : `Brick + Timber unit ${sourceListingId}`,
    fetchDepth: "detail", // the API is the complete record; no separate page needed
    description: apt.description?.trim() || null,
    rawDescription: apt.description?.trim() || null,
    propertyName: apt.propertyName ?? property?.propertyName ?? null,
    unitNumberPublic: unit,
    addressRaw: address,
    neighborhood:
      matchNeighborhood(property?.neighborhood)?.name ??
      matchNeighborhood(apt.description)?.name ??
      null,
    sourceNeighborhoodRaw: property?.neighborhood ?? null,
    city: "San Francisco",
    state: property?.state ?? "CA",
    postalCode: property?.zipcode ?? null,
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lng : null,
    geocodePrecision: hasCoords ? "building" : null,
    priceRaw: apt.minrent ? `$${apt.minrent}` : null,
    priceMonthly,
    priceEffectiveMonthly: computeEffectiveMonthly(priceMonthly, concessionsRaw),
    concessionsRaw,
    bedroomsRaw: apt.beds || apt.floorplanName || null,
    bedrooms: bedsNum,
    bathroomsRaw: apt.baths || null,
    bathrooms: bathsNum,
    squareFeetRaw: apt.sqft ? `${apt.sqft} sqft` : null,
    squareFeet: parseSquareFeet(apt.sqft ? `${apt.sqft} sqft` : null),
    propertyType: "apartment",
    listingType: "rent",
    photos,
    primaryPhotoUrl: photos[0] ?? null,
    amenitiesRaw: amenities,
    amenitiesNormalized: amenities.map((a) => a.toLowerCase()),
    catsAllowed: petFriendly ? true : null,
    dogsAllowed: petFriendly ? true : null,
    petPolicyRaw: petFriendly ? "Pet Friendly" : null,
    applicationUrl: apt.applyOnlineURL?.trim() || null,
    listingStatus: "active",
    rawPayload: { apartment: { ...apt, apartmentImages: undefined }, property },
  };
}

export const rentBtAdapter: SourceAdapter = {
  adapterType: "rentbt",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const baseUrl = ctx.source.baseUrl ?? "https://rentbt.com";
    const apiUrl = `${baseUrl}${API_PATH}`;

    const res = await ctx.fetcher.fetchText(apiUrl, {
      headers: { Accept: "application/json" },
    });
    result.pagesVisited = 1;
    if (!res.ok) {
      result.fatalError = `property-search API fetch failed: ${res.error}`;
      result.pageTrace.push({
        page: 1,
        url: apiUrl,
        httpStatus: res.status,
        listingsExtracted: 0,
        note: res.error ?? undefined,
      });
      return result;
    }
    result.htmlHash = sha256Hex(res.text);
    ctx.saveDebug("property-search.json", res.text);

    let data: BtApiResponse;
    try {
      data = JSON.parse(res.text) as BtApiResponse;
    } catch (err) {
      result.fatalError = `could not parse property-search JSON: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    const apartments = Array.isArray(data.apartments) ? data.apartments : [];
    const properties = Array.isArray(data.properties) ? data.properties : [];
    if (apartments.length === 0) {
      result.fatalError =
        "property-search API returned zero apartments — structure may have changed";
      result.paginationCompleted = false;
      return result;
    }
    const propertyById = new Map(properties.map((p) => [p.propertyId, p]));

    const listings: NormalizedListing[] = [];
    for (const apt of apartments) {
      const listing = buildListingFromApi(apt, propertyById.get(apt.propertyId), baseUrl);
      if (listing) listings.push(listing);
    }

    result.listings = listings;
    // The API returns the complete current set in one response.
    result.paginationCompleted = true;
    result.detailExtractionCompleted = true;
    result.totalListingsReportedBySource = listings.length;
    result.pageTrace.push({
      page: 1,
      url: apiUrl,
      httpStatus: res.status,
      listingsExtracted: listings.length,
      note: `${apartments.length} apartments in feed; ${apartments.length - listings.length} filtered as outside SF`,
    });
    ctx.log(
      `rentbt: ${listings.length} SF units from ${apartments.length} in the property-search feed`,
    );
    return result;
  },
};
