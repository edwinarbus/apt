/**
 * Shared domain types for Apt — a personal, non-commercial SF apartment scout.
 * Original listings are always the source of truth; raw values are preserved
 * alongside normalized ones, and uncertain fields stay null instead of guessed.
 */

export type GeocodePrecision =
  | "exact_address"
  | "building"
  | "block"
  | "neighborhood"
  | "city"
  | "unknown";

export type StaleStatus =
  | "active"
  | "still_seen"
  | "missing_once"
  | "missing_multiple_runs"
  | "likely_unavailable"
  | "source_failed_do_not_update"
  | "unknown";

export type ListingStatus =
  | "active"
  | "removed_by_source"
  | "expired"
  | "rented"
  | "unknown";

export type ScamRiskLevel = "none" | "watch" | "verify_carefully";

export type UserListingStatus =
  | "saved"
  | "hidden"
  | "contacted"
  | "not_a_fit"
  | "maybe"
  | "toured"
  | "applied"
  | "rented_elsewhere"
  | "suspicious";

export type RunStatus = "success" | "partial" | "failed" | "skipped";

export type SourceSystem =
  | "craigslist"
  | "property_manager_direct"
  | "zillow_manual_or_reference"
  | "apartments_manual_or_reference"
  | "rentsfnow"
  | "direct_html"
  | "direct_js"
  | "mock"
  | "unknown";

export type SourcePriority =
  | "critical"
  | "high"
  | "normal"
  | "reference_only";

export type PermissionStatus =
  | "ok_personal_low_frequency"
  | "unknown"
  | "needs_review"
  | "reference_only_do_not_fetch";

export type RobotsStatus =
  | "not_checked"
  | "allowed"
  | "disallowed"
  | "partial"
  | "no_robots_txt"
  | "error";

export type LaundryType =
  | "in_unit"
  | "in_building"
  | "hookups"
  | "none"
  | "unknown";

export type ParkingType =
  | "garage"
  | "off_street"
  | "street"
  | "none"
  | "unknown";

export type FetchDepth = "card" | "detail";

export type ListingEventType =
  | "first_seen"
  | "price_change"
  | "content_change"
  | "stale_change"
  | "listing_status_change"
  | "reappeared";

/**
 * The shared internal shape every adapter returns. Only identity fields are
 * required; everything else is optional and defaults to null/unknown in the DB.
 * `fetchDepth` tells the upserter whether this record came from a full detail
 * page ("detail") or just a search-results card ("card") so a shallow re-crawl
 * never wipes previously captured detail fields.
 */
export interface NormalizedListing {
  sourceListingId: string;
  originalUrl: string;
  title: string;
  fetchDepth: FetchDepth;

  description?: string | null;
  rawDescription?: string | null;
  propertyName?: string | null;
  unitNumberPublic?: string | null;

  addressRaw?: string | null;
  addressNormalized?: string | null;
  neighborhood?: string | null;
  sourceNeighborhoodRaw?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocodePrecision?: GeocodePrecision | null;

  priceRaw?: string | null;
  priceMonthly?: number | null;
  priceEffectiveMonthly?: number | null;
  concessionsRaw?: string | null;
  depositRaw?: string | null;
  depositAmount?: number | null;

  bedroomsRaw?: string | null;
  bedrooms?: number | null;
  bathroomsRaw?: string | null;
  bathrooms?: number | null;
  squareFeetRaw?: string | null;
  squareFeet?: number | null;

  propertyType?: string | null;
  listingType?: string | null;
  leaseTermRaw?: string | null;
  leaseTermMonths?: number | null;
  moveInDate?: string | null;
  availableDate?: string | null;
  postedDateRaw?: string | null;
  postedAt?: string | null;

  photos?: string[] | null;
  primaryPhotoUrl?: string | null;
  floorPlanUrls?: string[] | null;
  virtualTourUrl?: string | null;

  amenitiesRaw?: string[] | null;
  amenitiesNormalized?: string[] | null;
  laundryRaw?: string | null;
  laundryNormalized?: LaundryType | null;
  parkingRaw?: string | null;
  parkingNormalized?: ParkingType | null;
  petPolicyRaw?: string | null;
  catsAllowed?: boolean | null;
  dogsAllowed?: boolean | null;
  dogRestrictionsRaw?: string | null;
  utilitiesRaw?: string | null;
  utilitiesIncluded?: string[] | null;

  applicationFeeRaw?: string | null;
  applicationFee?: number | null;
  brokerFeeRaw?: string | null;
  brokerFee?: number | null;

  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
  showingInfoRaw?: string | null;
  applicationUrl?: string | null;

  listingStatus?: ListingStatus | null;
  rawPayload?: unknown;
}

export interface PageTraceEntry {
  page: number;
  url: string;
  httpStatus: number | null;
  listingsExtracted: number;
  note?: string;
}

export interface PaginationTrace {
  pages: PageTraceEntry[];
  totalReportedBySource: number | null;
  completed: boolean | null;
  warnings: string[];
}
