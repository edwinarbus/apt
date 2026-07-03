/**
 * Turn a listing the user thumbs-downed into a small set of BASIC, comparable
 * characteristics — the raw material Porter's memory of disliked apartments is
 * built from. Deliberately coarse and few: the point is to spot characteristics
 * that RECUR across several disliked listings (e.g. carpet), not to fingerprint
 * any single one. Everything here is about the unit, never the people — no
 * protected-class or demographic signal is ever derived (project rule).
 */

export interface DislikeFacts {
  title: string | null;
  addressRaw: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** effective monthly if known, else asking */
  priceMonthly: number | null;
  neighborhood: string | null;
  parking: string | null; // parkingNormalized
  laundry: string | null; // laundryNormalized
  catsAllowed: boolean | null;
  dogsAllowed: boolean | null;
  squareFeet: number | null;
  propertyType: string | null;
  /** AI vision feature tags (for flooring etc.) */
  visualTags: string[];
  description: string | null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 1,000-dollar price bands keep the trait coarse enough to recur. */
function priceBand(p: number | null): string | null {
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  if (p < 1000) return "price:under-1k";
  const lo = Math.floor(p / 1000);
  return `price:${lo}k-${lo + 1}k`;
}

/** Flooring isn't a structured field — read it from the vision tags + description. */
const FLOORING: Array<{ tag: string; re: RegExp }> = [
  { tag: "flooring:carpet", re: /\bcarpet(ed|ing)?\b/i },
  { tag: "flooring:hardwood", re: /\bhardwood\b/i },
  { tag: "flooring:laminate", re: /\blaminate\b/i },
  { tag: "flooring:tile", re: /\btile(d)?\s+floor/i },
  { tag: "flooring:vinyl", re: /\bvinyl\b/i },
];

/**
 * The compact characteristic tags for one disliked listing. Only known,
 * meaningful facts become tags — unknowns are simply left out (they can't be a
 * shared aversion). Tags are namespaced (`flooring:carpet`) so distinct
 * categories never collide when we count recurrence.
 */
export function characteristicTags(f: DislikeFacts): string[] {
  const tags = new Set<string>();

  if (f.bedrooms != null) {
    tags.add(`beds:${f.bedrooms === 0 ? "studio" : Math.round(f.bedrooms)}`);
  }
  const band = priceBand(f.priceMonthly);
  if (band) tags.add(band);
  if (f.neighborhood) tags.add(`hood:${slug(f.neighborhood)}`);
  if (f.parking && f.parking !== "unknown") tags.add(`parking:${slug(f.parking)}`);
  if (f.laundry && f.laundry !== "unknown") tags.add(`laundry:${slug(f.laundry)}`);
  // "No pets" is a characterful aversion; pets-ok is the norm, so we skip it.
  if (f.catsAllowed === false && f.dogsAllowed === false) tags.add("pets:none");
  if (f.propertyType) tags.add(`type:${slug(f.propertyType)}`);
  if (f.squareFeet != null) {
    if (f.squareFeet < 600) tags.add("size:compact");
    else if (f.squareFeet > 1200) tags.add("size:large");
  }

  const floorHay = `${f.visualTags.join(" ")} ${f.description ?? ""}`;
  for (const { tag, re } of FLOORING) if (re.test(floorHay)) tags.add(tag);

  return [...tags];
}

/** A human-readable label for a namespaced tag (for the "e.g. carpet" hint). */
export function friendlyTag(tag: string): string {
  const [cat, ...rest] = tag.split(":");
  const val = rest.join(":");
  switch (cat) {
    case "flooring":
      return `${val} flooring`;
    case "parking":
      return val === "none" ? "no parking" : `${val.replace(/-/g, " ")} parking`;
    case "laundry":
      return val === "none" ? "no laundry" : `${val.replace(/-/g, " ")} laundry`;
    case "pets":
      return "no pets allowed";
    case "beds":
      return val === "studio" ? "studio" : `${val} bed`;
    case "price":
      return val === "under-1k" ? "under $1k" : `$${val.replace("-", "–")}`;
    case "hood":
      return val.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    case "size":
      return val === "compact" ? "compact size" : "large size";
    case "type":
      return val.replace(/-/g, " ");
    default:
      return val.replace(/-/g, " ");
  }
}

/**
 * The short document stored in the Claude memory store for one disliked
 * listing. Framed as a personal-preference signal (never a judgment of the
 * listing), with an explicit "weigh lightly / only avoid recurring traits"
 * instruction so the agent doesn't over-index on a single dislike.
 */
export function dislikeMemoryDoc(f: DislikeFacts, tags: string[]): string {
  const where = f.addressRaw ?? f.title ?? "an apartment";
  const facts = [
    f.priceMonthly != null ? `$${Math.round(f.priceMonthly)}/mo` : null,
    f.bedrooms != null ? (f.bedrooms === 0 ? "studio" : `${Math.round(f.bedrooms)} bed`) : null,
    f.neighborhood,
  ]
    .filter(Boolean)
    .join(" · ");
  const friendly = tags.map(friendlyTag).join(", ") || "(no distinctive characteristics)";
  return [
    `# Disliked apartment — ${where}`,
    ``,
    `The user thumbs-downed this listing. This is a personal-preference signal about the unit's characteristics, not a judgment of the listing or anyone involved.`,
    ``,
    facts ? `Facts: ${facts}` : null,
    `Characteristics: ${friendly}`,
    ``,
    `Weigh lightly: only steer away from characteristics that RECUR across several disliked apartments; never infer anything about people or neighborhoods.`,
  ]
    .filter((l) => l != null)
    .join("\n");
}
