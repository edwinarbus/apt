import { z } from "zod";

/**
 * The structured shape Claude (vision) must return for one listing's photos.
 * Everything here is *observational* — what is visibly present in the images —
 * and additive on top of the deterministic listing fields. The original
 * listing and its photos remain the source of truth; this exists so the UI can
 * do natural-language visual search ("hardwood floors and bay windows").
 *
 * Bump VISION_SCHEMA_VERSION when the shape or prompt changes so a re-run
 * re-analyzes listings whose stored vision used an older version.
 */
export const VISION_SCHEMA_VERSION = 2;

export const ConditionEnum = z.enum([
  "renovated",
  "modern",
  "standard",
  "dated",
  "unknown",
]);

export const RoomObservation = z.object({
  /** e.g. "kitchen", "bathroom", "bedroom", "living room", "exterior" */
  room: z.string(),
  /** short, concrete description of what's visible in that room */
  details: z.string(),
});

export const VisionSchema = z.object({
  /** 1–3 neutral sentences describing what the photos actually show */
  visualSummary: z.string(),
  /**
   * Concise, searchable visual feature phrases seen in the photos, e.g.
   * "hardwood floors", "bay windows", "stainless steel appliances". Only
   * features actually visible — never inferred. [] if the photos show none.
   */
  features: z.array(z.string()),
  /** per-room observations, when the photos make the room clear */
  rooms: z.array(RoomObservation),
  /** overall visible condition/style impression (observational, neutral) */
  condition: ConditionEnum,
  /**
   * Anything notable and verifiable from the images only — e.g. "a watermark
   * from another rental site is visible", "photos look like a staging render".
   * Neutral and factual; NEVER a fraud accusation. null when nothing stands out.
   */
  notes: z.string().nullable(),
});

export type Vision = z.infer<typeof VisionSchema>;

/** Input handed to the model for one listing (image URLs already public/scraped). */
export interface VisionInput {
  listingId: string;
  title: string;
  neighborhood: string | null;
  /**
   * The listing's own basic info, passed as grounding CONTEXT so the model can
   * name features the way the description does, confirm/deny claimed features,
   * and flag photo↔description mismatches — never as features to copy blindly.
   */
  propertyName: string | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  priceRaw: string | null;
  amenitiesRaw: string[] | null;
  /** http(s) image URLs, already deduped and capped by the orchestrator */
  imageUrls: string[];
}

/**
 * Build the denormalized, lowercased blob used for fast client-side visual
 * search. Combines every text signal from the vision result so a query like
 * "hardwood floors and bay windows" can match. Kept in one place so the stored
 * column and any recompute stay identical.
 */
export function buildVisionSearchText(v: Vision): string {
  const parts = [
    ...v.features,
    v.visualSummary,
    ...v.rooms.map((r) => `${r.room} ${r.details}`),
    v.condition,
    v.notes ?? "",
  ];
  return parts.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Explicit description of the required JSON shape, embedded in the system
 * prompt. We validate the reply with VisionSchema, so this is guidance kept in
 * lockstep with the Zod schema above.
 */
export const VISION_SCHEMA_DESCRIPTION = `Return ONLY a single JSON object (no prose, no markdown fences) with exactly these keys:
{
  "visualSummary": string,               // 1-3 neutral sentences on what the photos actually show
  "features": string[],                  // short searchable phrases for features VISIBLE in the photos (e.g. "hardwood floors", "bay windows", "stainless steel appliances", "in-unit laundry", "updated kitchen", "tile bathroom", "walk-in closet", "exposed brick", "high ceilings", "natural light", "city view"); [] if none are clearly visible
  "rooms": [                             // one entry per room the photos make clear; [] if unclear
    { "room": string, "details": string }
  ],
  "condition": "renovated" | "modern" | "standard" | "dated" | "unknown",
  "notes": string | null                 // notable, verifiable observations from the images only (e.g. a visible watermark); neutral, NEVER a fraud accusation; null if nothing stands out
}`;
