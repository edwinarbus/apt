import { z } from "zod";

/**
 * The AI natural-language search. Claude receives the user's free-text query
 * plus a compact profile of each candidate listing and returns ranked matches
 * with reasons — combining its own SF neighborhood/geography knowledge with the
 * listing's description, structured data, and photo-vision analysis.
 */

export const SearchOutputSchema = z.object({
  /** one-sentence restatement of what the user is looking for */
  interpretation: z.string(),
  /** short parsed-criteria chips for display, e.g. ["studio","Marina","in-unit laundry"] */
  intentChips: z.array(z.string()),
  matches: z.array(
    z.object({
      id: z.string(),
      /** 0–100 overall fit */
      score: z.number(),
      /** one-sentence why, citing the specific matching signals */
      reason: z.string(),
    }),
  ),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

/**
 * Compact per-listing profile handed to the model for ranking. Blends the four
 * signals the user asked for: listing data, description, vision features, and
 * (via the model's own knowledge) neighborhood/geography. `distanceMi` is from
 * the user's location when they've shared it.
 */
export interface CandidateProfile {
  id: string;
  title: string;
  neighborhood: string | null;
  addressRaw: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  priceMonthly: number | null;
  laundry: string | null;
  parking: string | null;
  catsAllowed: boolean | null;
  dogsAllowed: boolean | null;
  amenities: string[];
  visualFeatures: string[];
  visualSummary: string | null;
  descriptionSnippet: string | null;
  distanceMi: number | null;
}
