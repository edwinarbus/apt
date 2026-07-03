import type { LaundryType, ParkingType, UserListingStatus } from "./types";

/**
 * Deterministic saved-search matching. This is intentionally simple: concrete
 * user preferences only (price, location, size, pets, laundry, parking,
 * dates, keywords, distance). No fuzzy scoring, no AI — that is a later,
 * clearly separated enrichment layer.
 *
 * Unknown listing fields are reported in `unknowns` rather than silently
 * passing or failing, so the UI can distinguish "matches" from "matches, but
 * verify pet policy with the source".
 */

export interface SavedSearchCriteria {
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  minSquareFeet?: number;
  maxPricePerSquareFoot?: number;
  neighborhoods?: string[];
  requireCatsAllowed?: boolean;
  requireDogsAllowed?: boolean;
  laundry?: LaundryType[];
  parking?: ParkingType[];
  /** listing must be available on or before this ISO date */
  availableBy?: string;
  maxDistanceKm?: number;
  centerLat?: number;
  centerLng?: number;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  /** The raw natural-language query this search was saved from (UX/provenance). */
  query?: string;
  /**
   * When true, Autopilot prepares a ready-to-send application for each NEW
   * listing that matches, queued for the user to send in one tap.
   */
  autoApply?: boolean;
}

export interface MatchableListing {
  priceMonthly: number | null;
  priceEffectiveMonthly: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  pricePerSquareFoot: number | null;
  neighborhood: string | null;
  catsAllowed: boolean | null;
  dogsAllowed: boolean | null;
  laundryNormalized: string | null;
  parkingNormalized: string | null;
  availableDate: string | null;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  description: string | null;
}

export interface MatchResult {
  /** false when the user has excluded this listing (hidden / not_a_fit / rented_elsewhere) */
  eligible: boolean;
  /** every known criterion passed */
  matched: boolean;
  /** criteria that failed against known values */
  failed: string[];
  /** criteria that could not be evaluated because the listing field is unknown */
  unknowns: string[];
  distanceKm: number | null;
}

const EXCLUDED_STATUSES: UserListingStatus[] = [
  "hidden",
  "not_a_fit",
  "rented_elsewhere",
];

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateListing(
  listing: MatchableListing,
  criteria: SavedSearchCriteria,
  userStatus?: UserListingStatus | null,
): MatchResult {
  const failed: string[] = [];
  const unknowns: string[] = [];
  let distanceKm: number | null = null;

  const eligible = !userStatus || !EXCLUDED_STATUSES.includes(userStatus);

  const effectivePrice =
    listing.priceEffectiveMonthly ?? listing.priceMonthly;
  if (criteria.minPrice != null || criteria.maxPrice != null) {
    if (effectivePrice == null) failed.push("price:unknown");
    else {
      if (criteria.minPrice != null && effectivePrice < criteria.minPrice)
        failed.push(`price:below_min($${effectivePrice})`);
      if (criteria.maxPrice != null && effectivePrice > criteria.maxPrice)
        failed.push(`price:above_max($${effectivePrice})`);
    }
  }

  if (criteria.minBedrooms != null || criteria.maxBedrooms != null) {
    if (listing.bedrooms == null) unknowns.push("bedrooms");
    else {
      if (criteria.minBedrooms != null && listing.bedrooms < criteria.minBedrooms)
        failed.push("bedrooms:below_min");
      if (criteria.maxBedrooms != null && listing.bedrooms > criteria.maxBedrooms)
        failed.push("bedrooms:above_max");
    }
  }

  if (criteria.minBathrooms != null) {
    if (listing.bathrooms == null) unknowns.push("bathrooms");
    else if (listing.bathrooms < criteria.minBathrooms)
      failed.push("bathrooms:below_min");
  }

  if (criteria.minSquareFeet != null) {
    if (listing.squareFeet == null) unknowns.push("square_feet");
    else if (listing.squareFeet < criteria.minSquareFeet)
      failed.push("square_feet:below_min");
  }

  if (criteria.maxPricePerSquareFoot != null) {
    if (listing.pricePerSquareFoot == null) unknowns.push("price_per_sqft");
    else if (listing.pricePerSquareFoot > criteria.maxPricePerSquareFoot)
      failed.push("price_per_sqft:above_max");
  }

  if (criteria.neighborhoods && criteria.neighborhoods.length > 0) {
    const wanted = criteria.neighborhoods.map((n) => n.toLowerCase());
    if (!listing.neighborhood) unknowns.push("neighborhood");
    else if (!wanted.includes(listing.neighborhood.toLowerCase()))
      failed.push(`neighborhood:${listing.neighborhood}`);
  }

  if (criteria.requireCatsAllowed) {
    if (listing.catsAllowed == null) unknowns.push("cat_policy");
    else if (!listing.catsAllowed) failed.push("cats:not_allowed");
  }
  if (criteria.requireDogsAllowed) {
    if (listing.dogsAllowed == null) unknowns.push("dog_policy");
    else if (!listing.dogsAllowed) failed.push("dogs:not_allowed");
  }

  if (criteria.laundry && criteria.laundry.length > 0) {
    if (!listing.laundryNormalized || listing.laundryNormalized === "unknown")
      unknowns.push("laundry");
    else if (!criteria.laundry.includes(listing.laundryNormalized as LaundryType))
      failed.push(`laundry:${listing.laundryNormalized}`);
  }

  if (criteria.parking && criteria.parking.length > 0) {
    if (!listing.parkingNormalized || listing.parkingNormalized === "unknown")
      unknowns.push("parking");
    else if (!criteria.parking.includes(listing.parkingNormalized as ParkingType))
      failed.push(`parking:${listing.parkingNormalized}`);
  }

  if (criteria.availableBy) {
    if (!listing.availableDate) unknowns.push("available_date");
    else if (listing.availableDate > criteria.availableBy)
      failed.push(`available:${listing.availableDate}_after_${criteria.availableBy}`);
  }

  if (
    criteria.maxDistanceKm != null &&
    criteria.centerLat != null &&
    criteria.centerLng != null
  ) {
    if (listing.latitude == null || listing.longitude == null) {
      unknowns.push("location");
    } else {
      distanceKm =
        Math.round(
          haversineKm(
            criteria.centerLat,
            criteria.centerLng,
            listing.latitude,
            listing.longitude,
          ) * 100,
        ) / 100;
      if (distanceKm > criteria.maxDistanceKm)
        failed.push(`distance:${distanceKm}km`);
    }
  }

  const haystack = `${listing.title ?? ""}\n${listing.description ?? ""}`.toLowerCase();
  for (const kw of criteria.includeKeywords ?? []) {
    if (!haystack.includes(kw.toLowerCase())) failed.push(`missing_keyword:${kw}`);
  }
  for (const kw of criteria.excludeKeywords ?? []) {
    if (haystack.includes(kw.toLowerCase())) failed.push(`excluded_keyword:${kw}`);
  }

  return {
    eligible,
    matched: eligible && failed.length === 0,
    failed,
    unknowns,
    distanceKm,
  };
}
