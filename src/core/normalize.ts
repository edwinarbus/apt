import type { LaundryType, ParkingType } from "./types";

/**
 * Deterministic parsers for messy listing text. Every parser returns null when
 * it cannot be confident — callers keep the raw value alongside the parsed one.
 */

export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/\$?\s*(\d{3,6})(?:\.\d{1,2})?/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 100 || value > 100000) return null;
  return value;
}

export function parseBedrooms(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/\bstudio\b/.test(text)) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:br|bd|bed(?:room)?s?)\b/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0 || value > 12) return null;
  return value;
}

export function parseBathrooms(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/\b(shared|split)\s*ba/.test(text)) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:ba(?:th(?:room)?s?)?)\b/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 12) return null;
  return value;
}

export function parseSquareFeet(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw
    .replace(/,/g, "")
    .match(/(\d{2,5})\s*(?:ft2|ft²|sq\.?\s*ft\.?|sqft|square\s*feet)/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 80 || value > 20000) return null;
  return value;
}

export function computePricePerSquareFoot(
  priceMonthly: number | null | undefined,
  squareFeet: number | null | undefined,
): number | null {
  if (!priceMonthly || !squareFeet || squareFeet <= 0) return null;
  return Math.round((priceMonthly / squareFeet) * 100) / 100;
}

export function normalizeLaundry(
  raw: string | null | undefined,
): LaundryType | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/\bno laundry\b/.test(text)) return "none";
  if (/\b(w\/d in unit|washer\s*\/?\s*dryer in unit|in[- ]unit (laundry|washer)|laundry in unit)\b/.test(text)) {
    return "in_unit";
  }
  if (/\b(laundry (in bldg|in building|on site|on-site|room)|shared laundry|coin[- ]op|laundry facilities)\b/.test(text)) {
    return "in_building";
  }
  if (/\b(w\/d hookups?|washer\s*\/?\s*dryer hookups?|laundry hookups?)\b/.test(text)) {
    return "hookups";
  }
  return null;
}

export function normalizeParking(
  raw: string | null | undefined,
): ParkingType | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/\b(attached garage|detached garage|garage parking|parking garage|\bgarage\b|valet parking)\b/.test(text)) {
    return "garage";
  }
  if (/\b(off[- ]street|carport|driveway|assigned parking|parking included|parking available|parking spot)\b/.test(text)) {
    return "off_street";
  }
  if (/\bstreet parking\b/.test(text)) return "street";
  if (/\bno parking\b/.test(text)) return "none";
  return null;
}

export interface PetPolicy {
  catsAllowed: boolean | null;
  dogsAllowed: boolean | null;
  dogRestrictionsRaw: string | null;
}

export function parsePetPolicy(raw: string | null | undefined): PetPolicy {
  const policy: PetPolicy = {
    catsAllowed: null,
    dogsAllowed: null,
    dogRestrictionsRaw: null,
  };
  if (!raw) return policy;
  const text = raw.toLowerCase();

  if (/\bno pets\b|\bpets?[^a-z]{0,3}not allowed\b|\bpet[- ]free\b/.test(text)) {
    policy.catsAllowed = false;
    policy.dogsAllowed = false;
    return policy;
  }
  if (/\bpets? (are )?(ok|okay|welcome|allowed|friendly)\b|\bpet[- ]friendly\b/.test(text)) {
    policy.catsAllowed = true;
    policy.dogsAllowed = true;
  }
  if (/\bcats? (are )?(ok|okay|welcome|allowed)\b|\bcat[- ]friendly\b/.test(text)) {
    policy.catsAllowed = true;
  }
  if (/\bdogs? (are )?(ok|okay|welcome|allowed)\b|\bdog[- ]friendly\b/.test(text)) {
    policy.dogsAllowed = true;
  }
  if (/\bno dogs\b/.test(text)) policy.dogsAllowed = false;
  if (/\bno cats\b/.test(text)) policy.catsAllowed = false;
  if (/\bcats? only\b/.test(text)) {
    policy.catsAllowed = true;
    policy.dogsAllowed = false;
  }
  const restriction = text.match(
    /\b(small dogs?( only)?( under \d+ ?lbs?)?|dogs? under \d+ ?lbs?|one dog max|breed restrictions?[^.,;]*)/,
  );
  if (restriction) {
    policy.dogsAllowed = policy.dogsAllowed ?? true;
    policy.dogRestrictionsRaw = restriction[0].trim();
  }
  return policy;
}

/**
 * Estimate effective monthly rent from visible concession language.
 * Assumes a 12-month term when amortizing free time — a documented
 * simplification, the raw concession text is always preserved.
 */
export function computeEffectiveMonthly(
  priceMonthly: number | null | undefined,
  concessionsRaw: string | null | undefined,
): number | null {
  if (!priceMonthly || !concessionsRaw) return null;
  const text = concessionsRaw.toLowerCase();
  let freeMonths = 0;
  const months = text.match(/(\d+(?:\.\d+)?)\s*months? free/);
  const weeks = text.match(/(\d+(?:\.\d+)?)\s*weeks? free/);
  if (months) freeMonths = Number(months[1]);
  else if (weeks) freeMonths = Number(weeks[1]) / 4.345;
  if (freeMonths <= 0 || freeMonths >= 12) return null;
  return Math.round((priceMonthly * (12 - freeMonths)) / 12);
}

const CONCESSION_PATTERN =
  /(\d+(?:\.\d+)?\s*(?:months?|weeks?)\s+free(?:\s+rent)?[^.!\n]*|move[- ]in special[^.!\n]*|\$\d[\d,]*\s+off[^.!\n]*)/i;

export function extractConcessions(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const m = text.match(CONCESSION_PATTERN);
  return m ? m[0].trim() : null;
}

/**
 * Canonical key for comparing addresses across sources: lowercase, punctuation
 * stripped, whitespace collapsed, common street-suffix abbreviations unified.
 */
const SUFFIXES: Record<string, string> = {
  street: "st",
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  drive: "dr",
  court: "ct",
  place: "pl",
  road: "rd",
  lane: "ln",
  terrace: "ter",
  highway: "hwy",
  parkway: "pkwy",
};

export function normalizeAddressKey(
  address: string | null | undefined,
  unit?: string | null,
): string | null {
  if (!address) return null;
  let key = address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;
  key = key
    .split(" ")
    .map((word) => SUFFIXES[word] ?? word)
    .join(" ");
  const unitKey = unit
    ? unit.toLowerCase().replace(/[^a-z0-9]/g, "")
    : null;
  return unitKey ? `${key}|${unitKey}` : key;
}

/**
 * Extract a public unit number from a listing title. Craigslist property
 * managers embed units in titles ("1520 Gough St - 304", "Sunny 1BR! Unit
 * #1081C", "1690 North Point #305 - Stunning…") while leaving the structured
 * address unit-less. Conservative on purpose:
 *  - "#<token>" or "Unit <token>" anywhere is trusted;
 *  - a trailing "- <token>" is only trusted when the title itself is
 *    address-shaped (starts with a street number), so "2BR - 1050" (sqft)
 *    never becomes a unit.
 */
export function extractUnitFromTitle(
  title: string | null | undefined,
): string | null {
  if (!title) return null;
  const hash = title.match(/(?:#\s?|\bunit\s+#?)([A-Za-z]?\d{1,4}(?:-\d{1,4})?[A-Za-z]{0,2})\b/i);
  if (hash) return hash[1];
  const addressShaped = title.match(
    /^\d+\s+[A-Za-z][^-–#]{2,40}[-–]\s*([A-Za-z]?\d{1,4}(?:-\d{1,4})?[A-Za-z]{0,2})\s*$/,
  );
  if (addressShaped && /\d/.test(addressShaped[1])) return addressShaped[1];
  return null;
}

/** Strip HTML tags and collapse whitespace into readable plain text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** Parse a lease-term string like "12 month lease" into months. */
export function parseLeaseTermMonths(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (/month[- ]to[- ]month/.test(text)) return 1;
  const m = text.match(/(\d{1,2})\s*[- ]?months?/);
  if (!m) return null;
  const value = Number(m[1]);
  return value >= 1 && value <= 36 ? value : null;
}
