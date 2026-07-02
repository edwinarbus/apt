import type { ScamRiskLevel } from "./types";

/**
 * Deterministic "verify carefully" heuristics. This module never makes fraud
 * claims — it surfaces concrete signals so a human can double-check against
 * the original listing. Levels:
 *   none             — no signals
 *   watch            — one weak signal
 *   verify_carefully — one strong signal, or multiple weak signals
 */

export interface ScamAssessmentInput {
  title: string | null;
  description: string | null;
  priceMonthly: number | null;
  squareFeet: number | null;
  bedrooms: number | null;
  neighborhood: string | null;
  addressRaw: string | null;
  latitude: number | null;
  longitude: number | null;
  photoCount: number;
  /** Set by the runner when this listing's description hash appears in a different neighborhood. */
  descriptionSharedAcrossNeighborhoods?: boolean;
  /** Set by the runner when the search-card price and detail-page price disagree substantially. */
  cardDetailPriceMismatch?: boolean;
}

export interface ScamAssessment {
  level: ScamRiskLevel;
  warnings: string[];
}

/**
 * Rough citywide monthly-rent baseline by bedroom count, used only when there
 * is not enough live data to compute a neighborhood median. Deliberately
 * conservative — it exists to catch "$950 luxury 2BR in Pacific Heights",
 * not to judge real bargains.
 */
const STATIC_CITY_BASELINE: Record<number, number> = {
  0: 2200,
  1: 3100,
  2: 4300,
  3: 5700,
  4: 6900,
};

export interface PriceBaselines {
  /** key: `${neighborhood}|${bedrooms}` -> median monthly price */
  neighborhood: Map<string, number>;
  /** key: bedrooms -> citywide median */
  citywide: Map<number, number>;
}

export function computeBaselines(
  listings: Array<{
    neighborhood: string | null;
    bedrooms: number | null;
    priceMonthly: number | null;
  }>,
  minBucketSize = 8,
): PriceBaselines {
  const hoodBuckets = new Map<string, number[]>();
  const cityBuckets = new Map<number, number[]>();
  for (const l of listings) {
    if (l.priceMonthly == null || l.bedrooms == null) continue;
    if (l.neighborhood) {
      const key = `${l.neighborhood}|${l.bedrooms}`;
      (hoodBuckets.get(key) ?? hoodBuckets.set(key, []).get(key)!).push(
        l.priceMonthly,
      );
    }
    (cityBuckets.get(l.bedrooms) ?? cityBuckets.set(l.bedrooms, []).get(l.bedrooms)!).push(
      l.priceMonthly,
    );
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const neighborhood = new Map<string, number>();
  for (const [key, xs] of hoodBuckets) {
    if (xs.length >= minBucketSize) neighborhood.set(key, median(xs));
  }
  const citywide = new Map<number, number>();
  for (const [beds, xs] of cityBuckets) {
    if (xs.length >= minBucketSize) citywide.set(beds, median(xs));
  }
  return { neighborhood, citywide };
}

function baselineFor(
  baselines: PriceBaselines | null,
  neighborhood: string | null,
  bedrooms: number | null,
): number | null {
  if (bedrooms == null) return null;
  const bedKey = Math.min(Math.round(bedrooms), 4);
  if (baselines && neighborhood) {
    const hood = baselines.neighborhood.get(`${neighborhood}|${bedrooms}`);
    if (hood != null) return hood;
  }
  if (baselines) {
    const city = baselines.citywide.get(bedrooms);
    if (city != null) return city;
  }
  return STATIC_CITY_BASELINE[bedKey] ?? null;
}

const OFF_PLATFORM_PAYMENT =
  /\b(wire transfer|western union|moneygram|cashier'?s? check|money order first|zelle|venmo|cash ?app|bitcoin|crypto)\b/i;
const PAYMENT_BEFORE_VIEWING =
  /\b(deposit|payment|fee|money)\b[^.!\n]{0,60}\b(before|prior to|without)\b[^.!\n]{0,40}\b(viewing|tour|seeing|showing|visit)/i;
const OWNER_ABROAD =
  /\b(out of (the )?(country|state|town)|currently (abroad|overseas|traveling)|missionary|on a mission|military deployment|deployed overseas)\b/i;
const URGENCY_PRESSURE =
  /\b(act (fast|now|quickly)|first come,? first serve[d]?|won'?t last|send (the )?(deposit|money) (today|now|asap))\b/i;

export function assessListing(
  input: ScamAssessmentInput,
  baselines: PriceBaselines | null,
): ScamAssessment {
  const strong: string[] = [];
  const weak: string[] = [];
  const text = `${input.title ?? ""}\n${input.description ?? ""}`;

  const baseline = baselineFor(baselines, input.neighborhood, input.bedrooms);
  if (
    baseline != null &&
    input.priceMonthly != null &&
    input.priceMonthly < baseline * 0.55
  ) {
    strong.push(
      `price_far_below_baseline: $${input.priceMonthly}/mo vs ~$${Math.round(baseline)} typical for ${input.bedrooms}BR${input.neighborhood ? ` in ${input.neighborhood}` : " citywide"}`,
    );
  }
  if (
    input.squareFeet != null &&
    input.priceMonthly != null &&
    input.squareFeet >= 1200 &&
    input.priceMonthly < 2200
  ) {
    strong.push(
      `too_good_size_price_combo: ${input.squareFeet} sqft for $${input.priceMonthly}/mo`,
    );
  }
  if (OFF_PLATFORM_PAYMENT.test(text)) {
    strong.push("suspicious_payment_language: mentions wire/app-based payment");
  }
  if (PAYMENT_BEFORE_VIEWING.test(text)) {
    strong.push("payment_before_viewing_language");
  }
  if (OWNER_ABROAD.test(text)) {
    strong.push("owner_unavailable_language: classic remote-landlord pattern");
  }
  if (input.descriptionSharedAcrossNeighborhoods) {
    strong.push("duplicate_description_across_neighborhoods");
  }
  if (URGENCY_PRESSURE.test(text)) {
    weak.push("urgency_pressure_language");
  }
  if (input.cardDetailPriceMismatch) {
    weak.push("inconsistent_card_detail_price");
  }
  if (!input.addressRaw && input.latitude == null && !input.neighborhood) {
    weak.push("no_location_information");
  }
  if (input.photoCount === 0) {
    weak.push("no_photos");
  }
  if (/([^a-zA-Z0-9\s])\1{4,}/.test(input.title ?? "") || /(!{3,}|\${3,})/.test(input.title ?? "")) {
    weak.push("spammy_title_symbols");
  }

  const warnings = [...strong, ...weak];
  let level: ScamRiskLevel = "none";
  if (strong.length > 0 || weak.length >= 2) level = "verify_carefully";
  else if (weak.length === 1) level = "watch";
  return { level, warnings };
}
