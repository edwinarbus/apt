import { z } from "zod";

/**
 * The structured shape Claude must return for a single listing. This is the
 * contract for the AI enrichment layer — everything here is additive context
 * on top of the deterministic fields, never a replacement for the source of
 * truth (the original listing).
 *
 * Bump SCHEMA_VERSION when the shape or prompt changes so a re-run re-enriches
 * listings whose stored enrichment used an older version.
 */
export const SCHEMA_VERSION = 1;

export const LaundryEnum = z.enum([
  "in_unit",
  "in_building",
  "hookups",
  "none",
  "unknown",
]);
export const ParkingEnum = z.enum([
  "garage",
  "off_street",
  "street",
  "none",
  "unknown",
]);
export const RiskEnum = z.enum(["none", "low", "medium", "high"]);

export const EnrichmentSchema = z.object({
  /** 1–2 sentence neutral summary of the unit, from the listing text only */
  summary: z.string(),
  /** amenities explicitly mentioned in the text, normalized to short phrases */
  amenities: z.array(z.string()),
  /** laundry situation as stated; "unknown" when not mentioned */
  laundry: LaundryEnum,
  /** parking situation as stated; "unknown" when not mentioned */
  parking: ParkingEnum,
  /** true/false only when the text states it; null when not mentioned */
  catsAllowed: z.boolean().nullable(),
  dogsAllowed: z.boolean().nullable(),
  /** dog restrictions verbatim-ish (e.g. "small dogs under 25 lbs"), or null */
  dogRestrictions: z.string().nullable(),
  /** utilities the listing says are included */
  utilitiesIncluded: z.array(z.string()),
  /** lease length in months if stated (month-to-month = 1), else null */
  leaseTermMonths: z.number().int().positive().max(60).nullable(),
  /** concrete things to confirm with the source before contacting/paying */
  verifyBeforeContacting: z.array(z.string()),
  /** specific, useful questions to ask the landlord/PM */
  questionsForLandlord: z.array(z.string()),
  /** AI second opinion on listing risk — complements the deterministic flags */
  riskLevel: RiskEnum,
  /** neutral, observable signals only; never a fraud accusation */
  riskReasons: z.array(z.string()),
});

export type Enrichment = z.infer<typeof EnrichmentSchema>;

/** Input handed to the model for one listing (all fields already public/scraped). */
export interface EnrichmentInput {
  listingId: string;
  title: string;
  description: string | null;
  priceMonthly: number | null;
  priceRaw: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  neighborhood: string | null;
  addressRaw: string | null;
  sourceName: string;
  amenitiesRaw: string[] | null;
  /** deterministic scam signals already computed, for the model's context */
  deterministicScamWarnings: string[] | null;
}

/**
 * A compact, explicit description of the required JSON shape, embedded in the
 * system prompt. We validate the model's reply with EnrichmentSchema, so this
 * is guidance rather than hard enforcement — kept in lockstep with the Zod
 * schema above.
 */
export const SCHEMA_DESCRIPTION = `Return ONLY a single JSON object (no prose, no markdown fences) with exactly these keys:
{
  "summary": string,                     // 1-2 neutral sentences describing the unit, drawn only from the listing text
  "amenities": string[],                 // amenities explicitly mentioned, each a short phrase; [] if none stated
  "laundry": "in_unit" | "in_building" | "hookups" | "none" | "unknown",
  "parking": "garage" | "off_street" | "street" | "none" | "unknown",
  "catsAllowed": boolean | null,         // null unless the text clearly states cat policy
  "dogsAllowed": boolean | null,         // null unless the text clearly states dog policy
  "dogRestrictions": string | null,      // e.g. "small dogs under 25 lbs", else null
  "utilitiesIncluded": string[],         // utilities the listing says are included; [] if none stated
  "leaseTermMonths": number | null,      // lease length in months (month-to-month = 1), else null
  "verifyBeforeContacting": string[],    // concrete things to confirm with the source before contacting or paying
  "questionsForLandlord": string[],      // specific, useful questions to ask
  "riskLevel": "none" | "low" | "medium" | "high",
  "riskReasons": string[]                // neutral, observable signals only; NEVER a fraud accusation
}`;
