import type { Db } from "@/db/client";
import { listings, listingVision, userListingStates } from "@/db/schema";
import { estimateCostUsd, type SearchClient } from "./client";
import type { CandidateProfile } from "./schema";

export interface SearchGeo {
  lat: number;
  lng: number;
}

export interface SearchOptions {
  query: string;
  location?: SearchGeo | null;
  radiusMi?: number | null;
  /** include hidden / not-a-fit / likely-unavailable listings (default: exclude) */
  includeHiddenGone?: boolean;
  /** hard cap on candidates assembled from the DB */
  maxCandidates?: number;
  /** how many pre-ranked candidates to actually send to the model (latency/cost bound) */
  maxRank?: number;
}

/** Default number of candidates handed to the ranking model. Keeps one call fast. */
export const DEFAULT_MAX_RANK = 60;

const STOP_WORDS = new Set([
  "the", "and", "with", "within", "near", "for", "from", "into", "onto", "that",
  "this", "are", "apartment", "apartments", "apt", "min", "mins", "minute", "minutes",
  "walk", "want", "need", "looking", "place", "home", "unit",
]);

function candidateText(c: CandidateProfile): string {
  return [
    c.title,
    c.neighborhood,
    c.addressRaw,
    ...c.amenities,
    ...c.visualFeatures,
    c.visualSummary,
    c.descriptionSnippet,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  ];
}

/**
 * Cheap local relevance pre-rank so the model only ever ranks a bounded set.
 * Scores each candidate by how many query tokens appear in its searchable text
 * (title + neighborhood + amenities + vision features/summary + description).
 * Ties keep the assembled order (closest / newest first).
 */
export function prerankAndCap(
  query: string,
  candidates: CandidateProfile[],
  cap: number,
): CandidateProfile[] {
  if (candidates.length <= cap) return candidates;
  const tokens = queryTokens(query);
  if (tokens.length === 0) return candidates.slice(0, cap);
  const scored = candidates.map((c, i) => {
    const text = candidateText(c);
    let hits = 0;
    for (const t of tokens) if (text.includes(t)) hits++;
    return { c, i, hits };
  });
  scored.sort((a, b) => b.hits - a.hits || a.i - b.i);
  return scored.slice(0, cap).map((s) => s.c);
}

export interface SearchMatch {
  id: string;
  score: number;
  reason: string;
}

export interface SearchResult {
  interpretation: string;
  intentChips: string[];
  matches: SearchMatch[];
  candidateCount: number;
  model: string;
  costUsd: number;
  error: string | null;
}

const MILES_PER_KM = 0.621371;

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMi(a: SearchGeo, b: SearchGeo): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * MILES_PER_KM;
}

function snippet(text: string | null, max = 220): string | null {
  if (!text) return null;
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/**
 * Build the candidate set the model will rank: active, non-hidden listings
 * (optionally within a radius of the user), each blended into a compact profile
 * of data + amenities + vision + a description snippet.
 */
export function assembleCandidates(db: Db, opts: SearchOptions): CandidateProfile[] {
  const rows = db.select().from(listings).all();
  const visionById = new Map(
    db
      .select({
        listingId: listingVision.listingId,
        features: listingVision.features,
        visualSummary: listingVision.visualSummary,
      })
      .from(listingVision)
      .all()
      .map((v) => [v.listingId, v]),
  );
  const stateById = new Map(
    db.select().from(userListingStates).all().map((s) => [s.listingId, s.status]),
  );

  const out: CandidateProfile[] = [];
  for (const row of rows) {
    if (!opts.includeHiddenGone) {
      const status = stateById.get(row.id);
      if (status === "hidden" || status === "not_a_fit" || status === "rented_elsewhere") continue;
      if (row.listingStatus !== "active" || row.staleStatus === "likely_unavailable") continue;
    }
    let distanceMi: number | null = null;
    if (opts.location && row.latitude != null && row.longitude != null) {
      distanceMi = haversineMi(opts.location, { lat: row.latitude, lng: row.longitude });
      if (opts.radiusMi != null && distanceMi > opts.radiusMi) continue;
    }
    const vision = visionById.get(row.id);
    out.push({
      id: row.id,
      title: row.title,
      neighborhood: row.neighborhood,
      addressRaw: row.addressRaw,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      squareFeet: row.squareFeet,
      priceMonthly: row.priceEffectiveMonthly ?? row.priceMonthly,
      laundry: row.laundryNormalized,
      parking: row.parkingNormalized,
      catsAllowed: row.catsAllowed,
      dogsAllowed: row.dogsAllowed,
      amenities: row.amenitiesNormalized ?? row.amenitiesRaw ?? [],
      visualFeatures: vision?.features ?? [],
      visualSummary: vision?.visualSummary ?? null,
      descriptionSnippet: snippet(row.description),
      distanceMi,
    });
  }

  // Closest first when we have a location; otherwise newest-ish (DB order).
  if (opts.location) {
    out.sort((a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity));
  }
  const cap = opts.maxCandidates ?? 600;
  return out.length > cap ? out.slice(0, cap) : out;
}

export async function runSearch(
  db: Db,
  client: SearchClient,
  opts: SearchOptions,
): Promise<SearchResult> {
  const allCandidates = assembleCandidates(db, opts);
  const ranked = prerankAndCap(opts.query, allCandidates, opts.maxRank ?? DEFAULT_MAX_RANK);
  const base: SearchResult = {
    interpretation: "",
    intentChips: [],
    matches: [],
    candidateCount: allCandidates.length,
    model: client.model,
    costUsd: 0,
    error: null,
  };
  if (ranked.length === 0) {
    return { ...base, interpretation: "No listings to search (try widening your radius or filters)." };
  }

  const result = await client.search(opts.query, ranked);
  base.costUsd = estimateCostUsd(result.model, result.usage);
  base.model = result.model;
  if (!result.data) {
    return { ...base, error: result.error ?? "search failed" };
  }

  // Guard against hallucinated ids; clamp scores; order by score desc.
  const validIds = new Set(ranked.map((c) => c.id));
  const matches = result.data.matches
    .filter((m) => validIds.has(m.id))
    .map((m) => ({ id: m.id, score: Math.max(0, Math.min(100, m.score)), reason: m.reason }))
    .sort((a, b) => b.score - a.score);

  return {
    ...base,
    interpretation: result.data.interpretation,
    intentChips: result.data.intentChips,
    matches,
  };
}
