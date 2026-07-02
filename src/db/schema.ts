import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (via Drizzle). Timestamps are ISO-8601 UTC strings for easy
 * debugging; booleans are integers. JSON columns use drizzle's json text mode.
 * The layout deliberately mirrors what a later Postgres/PostGIS migration
 * would want: flat listing table, separate source/run/event/user-state tables.
 */

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(), // slug, e.g. "craigslist_sf"
  name: text("name").notNull(),
  sourceSystem: text("source_system").notNull(),
  adapterType: text("adapter_type").notNull(), // "craigslist" | "rentsfnow" | "mock" | "none"
  priority: text("priority").notNull().default("normal"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),

  listingUrl: text("listing_url"),
  baseUrl: text("base_url"),
  websiteUrl: text("website_url"),
  contactUrl: text("contact_url"),
  phone: text("phone"),
  email: text("email"),
  region: text("region"),
  city: text("city"),
  state: text("state"),

  crawlIntervalHours: integer("crawl_interval_hours").notNull().default(24),
  requestDelayMs: integer("request_delay_ms").notNull().default(2500),
  timeoutMs: integer("timeout_ms").notNull().default(20000),
  retryCount: integer("retry_count").notNull().default(2),
  maxPagesPerRun: integer("max_pages_per_run").notNull().default(10),
  maxDetailPagesPerRun: integer("max_detail_pages_per_run").notNull().default(40),
  geocodeEnabled: integer("geocode_enabled", { mode: "boolean" })
    .notNull()
    .default(true),

  needsJavaScript: integer("needs_javascript", { mode: "boolean" }),
  hasPagination: integer("has_pagination", { mode: "boolean" }),
  requiresDetailPages: integer("requires_detail_pages", { mode: "boolean" }),
  blocksAutomation: integer("blocks_automation", { mode: "boolean" }),
  safeForPersonalLowFrequencyFetching: integer(
    "safe_for_personal_low_frequency_fetching",
    { mode: "boolean" },
  ),
  permissionStatus: text("permission_status").notNull().default("unknown"),
  robotsStatus: text("robots_status").notNull().default("not_checked"),
  robotsCheckedAt: text("robots_checked_at"),
  robotsNotes: text("robots_notes"),
  sourceStatusNotes: text("source_status_notes"),
  notes: text("notes"),
  parserVersion: integer("parser_version").notNull().default(1),

  /**
   * Registry classification from the phase-two audit:
   * enabled_working | enabled_partial | disabled_reference_only |
   * disabled_needs_adapter | disabled_blocked_or_not_practical |
   * disabled_needs_review
   */
  registryStatus: text("registry_status").notNull().default("disabled_needs_review"),
  lastVerificationStatus: text("last_verification_status"), // PASS | PARTIAL | FAIL | SKIPPED
  lastVerificationAt: text("last_verification_at"),
  lastVerificationSummary: text("last_verification_summary", { mode: "json" }),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceRuns = sqliteTable(
  "source_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull().default("failed"), // success | partial | failed | skipped

    listingsFound: integer("listings_found").notNull().default(0),
    newListings: integer("new_listings").notNull().default(0),
    changedListings: integer("changed_listings").notNull().default(0),
    priceChangedListings: integer("price_changed_listings").notNull().default(0),
    missingListings: integer("missing_listings").notNull().default(0),
    suspectedDuplicates: integer("suspected_duplicates").notNull().default(0),
    suspectedScams: integer("suspected_scams").notNull().default(0),

    pagesVisited: integer("pages_visited").notNull().default(0),
    detailPagesVisited: integer("detail_pages_visited").notNull().default(0),
    totalListingsReportedBySource: integer("total_listings_reported_by_source"),
    paginationCompleted: integer("pagination_completed", { mode: "boolean" }),
    detailExtractionCompleted: integer("detail_extraction_completed", {
      mode: "boolean",
    }),
    /** whether missing-listing (stale) processing ran for this run */
    staleProcessed: integer("stale_processed", { mode: "boolean" })
      .notNull()
      .default(false),

    errorMessage: text("error_message"),
    warnings: text("warnings", { mode: "json" }).$type<string[]>(),
    paginationTrace: text("pagination_trace", { mode: "json" }),
    parserVersion: integer("parser_version"),
    htmlHash: text("html_hash"),
    rawDebugPath: text("raw_debug_path"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("source_runs_source_idx").on(t.sourceId, t.startedAt)],
);

export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    sourceSystem: text("source_system").notNull(),
    sourceListingId: text("source_listing_id").notNull(),
    originalUrl: text("original_url").notNull(),
    /** originalUrl with tracking params stripped and format normalized (dedupe key) */
    canonicalUrl: text("canonical_url"),

    title: text("title").notNull(),
    description: text("description"),
    rawDescription: text("raw_description"),
    propertyName: text("property_name"),
    unitNumberPublic: text("unit_number_public"),

    addressRaw: text("address_raw"),
    addressNormalized: text("address_normalized"),
    neighborhood: text("neighborhood"),
    sourceNeighborhoodRaw: text("source_neighborhood_raw"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    geocodePrecision: text("geocode_precision").notNull().default("unknown"),

    priceRaw: text("price_raw"),
    priceMonthly: real("price_monthly"),
    priceEffectiveMonthly: real("price_effective_monthly"),
    concessionsRaw: text("concessions_raw"),
    depositRaw: text("deposit_raw"),
    depositAmount: real("deposit_amount"),

    bedroomsRaw: text("bedrooms_raw"),
    bedrooms: real("bedrooms"),
    bathroomsRaw: text("bathrooms_raw"),
    bathrooms: real("bathrooms"),
    squareFeetRaw: text("square_feet_raw"),
    squareFeet: integer("square_feet"),
    pricePerSquareFoot: real("price_per_square_foot"),

    propertyType: text("property_type"),
    listingType: text("listing_type"),
    leaseTermRaw: text("lease_term_raw"),
    leaseTermMonths: integer("lease_term_months"),
    moveInDate: text("move_in_date"),
    availableDate: text("available_date"),
    postedDateRaw: text("posted_date_raw"),
    postedAt: text("posted_at"),

    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    missingSince: text("missing_since"),
    detailFetchedAt: text("detail_fetched_at"),
    staleStatus: text("stale_status").notNull().default("active"),
    listingStatus: text("listing_status").notNull().default("active"),

    photos: text("photos", { mode: "json" }).$type<string[]>(),
    primaryPhotoUrl: text("primary_photo_url"),
    floorPlanUrls: text("floor_plan_urls", { mode: "json" }).$type<string[]>(),
    virtualTourUrl: text("virtual_tour_url"),

    amenitiesRaw: text("amenities_raw", { mode: "json" }).$type<string[]>(),
    amenitiesNormalized: text("amenities_normalized", {
      mode: "json",
    }).$type<string[]>(),
    laundryRaw: text("laundry_raw"),
    laundryNormalized: text("laundry_normalized"),
    parkingRaw: text("parking_raw"),
    parkingNormalized: text("parking_normalized"),
    petPolicyRaw: text("pet_policy_raw"),
    catsAllowed: integer("cats_allowed", { mode: "boolean" }),
    dogsAllowed: integer("dogs_allowed", { mode: "boolean" }),
    dogRestrictionsRaw: text("dog_restrictions_raw"),
    utilitiesRaw: text("utilities_raw"),
    utilitiesIncluded: text("utilities_included", {
      mode: "json",
    }).$type<string[]>(),

    applicationFeeRaw: text("application_fee_raw"),
    applicationFee: real("application_fee"),
    brokerFeeRaw: text("broker_fee_raw"),
    brokerFee: real("broker_fee"),

    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    contactUrl: text("contact_url"),
    showingInfoRaw: text("showing_info_raw"),
    applicationUrl: text("application_url"),

    contentHash: text("content_hash").notNull(),
    descriptionHash: text("description_hash"),
    photoHash: text("photo_hash"),
    duplicateGroupId: text("duplicate_group_id"),
    scamRiskLevel: text("scam_risk_level").notNull().default("none"),
    scamWarnings: text("scam_warnings", { mode: "json" }).$type<string[]>(),
    rawPayload: text("raw_payload", { mode: "json" }),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("listings_source_listing_unique").on(
      t.sourceId,
      t.sourceListingId,
    ),
    index("listings_stale_idx").on(t.sourceId, t.staleStatus),
    index("listings_last_seen_idx").on(t.lastSeenAt),
  ],
);

export const listingEvents = sqliteTable(
  "listing_events",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    sourceRunId: text("source_run_id"),
    eventType: text("event_type").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("listing_events_listing_idx").on(t.listingId, t.createdAt)],
);

export const userListingStates = sqliteTable("user_listing_states", {
  listingId: text("listing_id")
    .primaryKey()
    .references(() => listings.id),
  status: text("status").notNull(), // saved | hidden | contacted | not_a_fit | maybe | toured | applied | rented_elsewhere | suspicious
  note: text("note"),
  updatedAt: text("updated_at").notNull(),
});

export const savedSearches = sqliteTable("saved_searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  criteria: text("criteria", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const geocodeCache = sqliteTable("geocode_cache", {
  addressKey: text("address_key").primaryKey(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  precision: text("precision").notNull().default("unknown"),
  provider: text("provider").notNull(),
  formattedAddress: text("formatted_address"),
  raw: text("raw", { mode: "json" }),
  createdAt: text("created_at").notNull(),
});

export const duplicateGroups = sqliteTable("duplicate_groups", {
  id: text("id").primaryKey(),
  /** the best record to represent the group (active, freshest, richest) */
  primaryListingId: text("primary_listing_id"),
  /** exact | high | medium | low — strongest signal in the group */
  confidence: text("confidence").notNull().default("low"),
  reasons: text("reasons", { mode: "json" }).$type<string[]>(),
  listingIds: text("listing_ids", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Structured price history: one row when a listing is first seen and one per
 * observed change of price / effective price. listing_events stays the
 * audit log; this table is the query-friendly history.
 */
export const priceHistory = sqliteTable(
  "price_history",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    sourceRunId: text("source_run_id"),
    observedAt: text("observed_at").notNull(),
    priceRaw: text("price_raw"),
    priceMonthly: real("price_monthly"),
    priceEffectiveMonthly: real("price_effective_monthly"),
    concessionsRaw: text("concessions_raw"),
    depositRaw: text("deposit_raw"),
  },
  (t) => [index("price_history_listing_idx").on(t.listingId, t.observedAt)],
);

export type PriceHistoryRow = typeof priceHistory.$inferSelect;

/**
 * Which listings currently match which saved search. One row per
 * (savedSearch, listing). `notifiedAt` is null until a digest has reported
 * the match, so the next digest can surface only genuinely new matches
 * without re-announcing everything. `stillMatching` lets a match linger as a
 * historical record after a listing stops matching (price rose, went stale)
 * without deleting the row.
 */
export const savedSearchMatches = sqliteTable(
  "saved_search_matches",
  {
    id: text("id").primaryKey(),
    savedSearchId: text("saved_search_id")
      .notNull()
      .references(() => savedSearches.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    firstMatchedAt: text("first_matched_at").notNull(),
    lastMatchedAt: text("last_matched_at").notNull(),
    /** when a digest last reported this match (null = never reported) */
    notifiedAt: text("notified_at"),
    /** price when the match was last reported, to detect drops on known matches */
    notifiedPriceMonthly: real("notified_price_monthly"),
    stillMatching: integer("still_matching", { mode: "boolean" }).notNull().default(true),
    distanceKm: real("distance_km"),
    unknowns: text("unknowns", { mode: "json" }).$type<string[]>(),
  },
  (t) => [
    uniqueIndex("saved_search_matches_unique").on(t.savedSearchId, t.listingId),
    index("saved_search_matches_search_idx").on(t.savedSearchId, t.stillMatching),
  ],
);

/** Audit record for each digest run. */
export const digestRuns = sqliteTable("digest_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  savedSearchesEvaluated: integer("saved_searches_evaluated").notNull().default(0),
  listingsEvaluated: integer("listings_evaluated").notNull().default(0),
  newMatches: integer("new_matches").notNull().default(0),
  priceDropMatches: integer("price_drop_matches").notNull().default(0),
  droppedMatches: integer("dropped_matches").notNull().default(0),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
  reportPath: text("report_path"),
});

export type SavedSearchMatchRow = typeof savedSearchMatches.$inferSelect;
export type DigestRunRow = typeof digestRuns.$inferSelect;

export type SourceRow = typeof sources.$inferSelect;
export type NewSourceRow = typeof sources.$inferInsert;
export type SourceRunRow = typeof sourceRuns.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;
export type ListingEventRow = typeof listingEvents.$inferSelect;
export type UserListingStateRow = typeof userListingStates.$inferSelect;
export type SavedSearchRow = typeof savedSearches.$inferSelect;
