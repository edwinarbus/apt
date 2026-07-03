import type {
  GeocodePrecision,
  RunStatus,
  ScamRiskLevel,
  StaleStatus,
  UserListingStatus,
} from "@/core/types";

/** Wire types shared between API routes and client components. */

export type BadgeKind =
  | "new_today"
  | "price_drop"
  | "price_increase"
  | "stale"
  | "likely_unavailable"
  | "verify_carefully"
  | "watch"
  | "duplicate"
  | "saved"
  | "contacted"
  | "maybe"
  | "toured"
  | "applied"
  | "suspicious"
  | "source_uncertain";

export interface PriceChangeInfo {
  oldPrice: number;
  newPrice: number;
  at: string;
}

export interface ListingSummary {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceSystem: string;
  originalUrl: string;
  title: string;
  propertyName: string | null;
  neighborhood: string | null;
  sourceNeighborhoodRaw: string | null;
  addressRaw: string | null;
  unitNumberPublic: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: GeocodePrecision;
  priceMonthly: number | null;
  priceEffectiveMonthly: number | null;
  concessionsRaw: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  pricePerSquareFoot: number | null;
  primaryPhotoUrl: string | null;
  photoCount: number;
  catsAllowed: boolean | null;
  dogsAllowed: boolean | null;
  laundryNormalized: string | null;
  parkingNormalized: string | null;
  availableDate: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;
  staleStatus: StaleStatus;
  listingStatus: string;
  scamRiskLevel: ScamRiskLevel;
  duplicateGroupId: string | null;
  userStatus: UserListingStatus | null;
  userNote: string | null;
  lastPriceChange: PriceChangeInfo | null;
  sourceLastRunStatus: RunStatus | null;
  sourceLastRunAt: string | null;
  badges: BadgeKind[];
  /** AI vision (Haiku): compact visible-feature tags for display + search chips */
  visualTags: string[];
  /** lowercased vision blob (features + summary + rooms) for local visual search; null if not analyzed */
  visualSearchText: string | null;
}

export interface ListingsResponse {
  listings: ListingSummary[];
  generatedAt: string;
}

/** AI natural-language search (POST /api/search). */
export interface SearchRequestBody {
  query: string;
  location?: { lat: number; lng: number } | null;
  radiusMi?: number | null;
  includeHiddenGone?: boolean;
}

export interface SearchMatch {
  id: string;
  /** 0–100 overall fit from the model */
  score: number;
  /** one-sentence why, citing the matching signals */
  reason: string;
}

export interface SearchResponse {
  query: string;
  interpretation: string;
  intentChips: string[];
  matches: SearchMatch[];
  candidateCount: number;
  model: string;
  error: string | null;
}

/** A drafted (never-sent) rental application the Scout stages for a match. */
export interface ApplicationDraftDto {
  listingId: string;
  listingTitle: string | null;
  to: string | null;
  channel: "email" | "phone" | "unknown";
  subject: string;
  body: string;
}

/** A saved search the overnight Scout watches, with its live match stats. */
export interface SavedSearchDto {
  id: string;
  name: string;
  query: string | null;
  autoApply: boolean;
  enabled: boolean;
  createdAt: string;
  /** active listings currently matching this search's criteria */
  matchCount: number;
  /** of those, how many are new in the last 24h */
  newMatchCount: number;
  /** for auto-apply searches, a drafted application for the freshest match */
  sampleDraft: ApplicationDraftDto | null;
}

export interface SavedSearchesResponse {
  searches: SavedSearchDto[];
}

export interface ListingEventPayload {
  id: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: string;
}

export interface DuplicatePeer {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  priceMonthly: number | null;
  originalUrl: string;
}

export interface DuplicateGroupInfo {
  id: string;
  confidence: "exact" | "high" | "medium" | "low";
  reasons: string[];
  primaryListingId: string | null;
  /** true when the group spans more than one source ("also seen on …") */
  crossSource: boolean;
}

export interface PriceHistoryEntry {
  observedAt: string;
  priceRaw: string | null;
  priceMonthly: number | null;
  priceEffectiveMonthly: number | null;
  concessionsRaw: string | null;
}

/** Optional AI vision analysis of the listing's photos (Claude vision, Haiku). Observational, never authoritative. */
export interface VisionPayload {
  model: string;
  analyzedAt: string;
  imageCount: number;
  visualSummary: string | null;
  features: string[];
  rooms: { room: string; details: string }[];
  condition: "renovated" | "modern" | "standard" | "dated" | "unknown" | null;
  notes: string | null;
}

/** Optional AI-generated enrichment (Claude). Clearly labeled and never authoritative. */
export interface EnrichmentPayload {
  model: string;
  enrichedAt: string;
  summary: string | null;
  aiRiskLevel: "none" | "low" | "medium" | "high" | null;
  amenities: string[];
  laundry: string | null;
  parking: string | null;
  utilitiesIncluded: string[];
  verifyBeforeContacting: string[];
  questionsForLandlord: string[];
  riskReasons: string[];
}

export interface ListingDetailResponse {
  listing: ListingSummary & {
    description: string | null;
    photos: string[];
    floorPlanUrls: string[];
    virtualTourUrl: string | null;
    amenitiesRaw: string[];
    utilitiesIncluded: string[];
    utilitiesRaw: string | null;
    petPolicyRaw: string | null;
    dogRestrictionsRaw: string | null;
    laundryRaw: string | null;
    parkingRaw: string | null;
    depositRaw: string | null;
    depositAmount: number | null;
    applicationFeeRaw: string | null;
    brokerFeeRaw: string | null;
    leaseTermRaw: string | null;
    moveInDate: string | null;
    priceRaw: string | null;
    bedroomsRaw: string | null;
    bathroomsRaw: string | null;
    squareFeetRaw: string | null;
    addressNormalized: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    scamWarnings: string[];
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    contactUrl: string | null;
    contactInheritedFromSource: boolean;
    sourceWebsiteUrl: string | null;
    showingInfoRaw: string | null;
    applicationUrl: string | null;
    detailFetchedAt: string | null;
  };
  events: ListingEventPayload[];
  duplicates: DuplicatePeer[];
  duplicateGroup: DuplicateGroupInfo | null;
  priceHistory: PriceHistoryEntry[];
  enrichment: EnrichmentPayload | null;
  vision: VisionPayload | null;
}

export interface SourceRunPayload {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  listingsFound: number;
  newListings: number;
  changedListings: number;
  priceChangedListings: number;
  missingListings: number;
  suspectedDuplicates: number;
  suspectedScams: number;
  pagesVisited: number;
  detailPagesVisited: number;
  totalListingsReportedBySource: number | null;
  paginationCompleted: boolean | null;
  detailExtractionCompleted: boolean | null;
  staleProcessed: boolean;
  errorMessage: string | null;
  warnings: string[];
}

/** Dashboard status vocabulary for a source, derived server-side. */
export type SourceOverallStatus =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "SKIPPED"
  | "DISABLED"
  | "REFERENCE_ONLY"
  | "NEEDS_REVIEW";

export interface SourceDashboardEntry {
  id: string;
  name: string;
  sourceSystem: string;
  adapterType: string;
  priority: string;
  enabled: boolean;
  registryStatus: string;
  overallStatus: SourceOverallStatus;
  lastVerificationStatus: string | null;
  lastVerificationAt: string | null;
  lastSuccessfulRunAt: string | null;
  /** listingsFound delta vs the previous run of this source (null = n/a) */
  listingCountTrend: number | null;
  listingUrl: string | null;
  websiteUrl: string | null;
  needsJavaScript: boolean | null;
  blocksAutomation: boolean | null;
  safeForPersonalLowFrequencyFetching: boolean | null;
  permissionStatus: string;
  robotsStatus: string;
  robotsCheckedAt: string | null;
  robotsNotes: string | null;
  sourceStatusNotes: string | null;
  notes: string | null;
  crawlIntervalHours: number;
  activeListings: number;
  totalListings: number;
  lastRun: SourceRunPayload | null;
  recentRuns: SourceRunPayload[];
}

export interface SourcesResponse {
  sources: SourceDashboardEntry[];
  generatedAt: string;
}
