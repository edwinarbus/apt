import { createHash } from "node:crypto";
import { photoKey } from "./hash";
import { extractUnitFromTitle, normalizeAddressKey } from "./normalize";
import { canonicalizeListingUrl } from "./urls";

/**
 * Deterministic duplicate detection within and across sources, with explicit
 * confidence. Listings are grouped (never merged): each group records which
 * signals formed it, the strongest confidence among them, and a primary
 * listing (the best record to represent the group).
 *
 * Signals and confidence:
 *   exact  — same canonical original URL
 *   high   — same normalized address + public unit number
 *          — same address + price + beds + baths (units must not conflict)
 *   medium — shared photo identity, units matching (Craigslist reposts;
 *            different units of one building share building photos and are
 *            deliberately NOT linked)
 *          — same description hash, units not conflicting (PM sites reuse
 *            per-building boilerplate across units)
 *   low    — same title + price + neighborhood
 *
 * "repost_candidate" is added when a photo/description link joins two
 * listings from the same source with different source listing ids — the
 * classic delete-and-repost pattern.
 *
 * Photo identity is source-scoped (different sites host different copies of
 * an image); cross-source photo matching needs perceptual hashing (future).
 */

export type DuplicateConfidence = "exact" | "high" | "medium" | "low";

export type DuplicateReason =
  | "same_canonical_url"
  | "same_address_unit"
  | "same_address_price_beds_baths"
  | "same_photo_hash"
  | "same_description_hash"
  | "similar_title_price_neighborhood"
  | "repost_candidate";

const REASON_CONFIDENCE: Record<DuplicateReason, DuplicateConfidence> = {
  same_canonical_url: "exact",
  same_address_unit: "high",
  same_address_price_beds_baths: "high",
  same_photo_hash: "medium",
  same_description_hash: "medium",
  similar_title_price_neighborhood: "low",
  repost_candidate: "medium",
};

const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = {
  exact: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function strongestConfidence(
  reasons: DuplicateReason[],
): DuplicateConfidence {
  let best: DuplicateConfidence = "low";
  for (const reason of reasons) {
    const c = REASON_CONFIDENCE[reason];
    if (CONFIDENCE_RANK[c] > CONFIDENCE_RANK[best]) best = c;
  }
  return best;
}

export interface DupeCandidate {
  id: string;
  sourceId: string;
  sourceListingId?: string | null;
  originalUrl?: string | null;
  title: string | null;
  priceMonthly: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  neighborhood: string | null;
  addressRaw: string | null;
  addressNormalized: string | null;
  unitNumberPublic: string | null;
  photos: string[] | null;
  descriptionHash: string | null;
  /** used to pick the primary listing */
  lastSeenAt?: string | null;
  firstSeenAt?: string | null;
  detailFetchedAt?: string | null;
  staleStatus?: string | null;
  listingStatus?: string | null;
}

export interface DuplicateGroup {
  id: string;
  confidence: DuplicateConfidence;
  reasons: DuplicateReason[];
  memberIds: string[];
  primaryListingId: string;
}

export interface DedupeResult {
  groups: DuplicateGroup[];
  /** listing ids whose description hash also appears in a different neighborhood (scam signal) */
  crossNeighborhoodDescriptionIds: Set<string>;
}

class UnionFind {
  private parent = new Map<string, string>();
  reasons = new Map<string, Set<DuplicateReason>>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string, reason: DuplicateReason): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
    const root = this.find(rb);
    const set = this.reasons.get(root) ?? new Set<DuplicateReason>();
    for (const r of this.reasons.get(ra) ?? []) set.add(r);
    for (const r of this.reasons.get(rb) ?? []) set.add(r);
    set.add(reason);
    this.reasons.set(root, set);
  }
}

const normUnit = (unit: string | null | undefined): string | null =>
  unit ? unit.toLowerCase().replace(/[^a-z0-9]/g, "") || null : null;

/**
 * Effective unit: the structured field, falling back to a unit embedded in
 * the title ("1520 Gough St - 304") — sources like Craigslist rarely expose
 * units structurally but property managers put them in titles.
 */
function effectiveUnit(c: DupeCandidate): string | null {
  return normUnit(c.unitNumberPublic) ?? normUnit(extractUnitFromTitle(c.title));
}

/** true when both listings name a unit and the units differ */
function unitsConflict(a: DupeCandidate, b: DupeCandidate): boolean {
  const ua = effectiveUnit(a);
  const ub = effectiveUnit(b);
  return ua != null && ub != null && ua !== ub;
}

function unitsEqual(a: DupeCandidate, b: DupeCandidate): boolean {
  return effectiveUnit(a) === effectiveUnit(b);
}

function addressOnlyKey(c: DupeCandidate): string | null {
  const key = normalizeAddressKey(c.addressNormalized ?? c.addressRaw, null);
  if (!key || !/\d/.test(key)) return null; // require a street number
  return key;
}

/**
 * true when both listings have street addresses and they differ — a
 * portfolio-wide boilerplate description or shared marketing photos must not
 * chain listings across different buildings into one group.
 */
function addressesConflict(a: DupeCandidate, b: DupeCandidate): boolean {
  const ka = addressOnlyKey(a);
  const kb = addressOnlyKey(b);
  return ka != null && kb != null && ka !== kb;
}

function normTitleKey(c: DupeCandidate): string | null {
  if (!c.title || c.priceMonthly == null || !c.neighborhood) return null;
  const title = c.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (title.length < 8) return null;
  return `${title}|${c.priceMonthly}|${c.neighborhood.toLowerCase()}`;
}

/**
 * Choose the best record to represent a group: prefer listings still active,
 * then most recently seen, then detail-fetched, then earliest first seen
 * (the original), then stable id order.
 */
export function pickPrimary(members: DupeCandidate[]): string {
  const score = (c: DupeCandidate) => [
    c.listingStatus === "active" && c.staleStatus === "active" ? 1 : 0,
    c.lastSeenAt ?? "",
    c.detailFetchedAt ? 1 : 0,
  ];
  const sorted = [...members].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sa[i] > sb[i] ? -1 : 1;
    }
    const fa = a.firstSeenAt ?? "";
    const fb = b.firstSeenAt ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0].id;
}

export function detectDuplicates(candidates: DupeCandidate[]): DedupeResult {
  const uf = new UnionFind();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const byCanonicalUrl = new Map<string, string>();
  const byAddressUnit = new Map<string, string>();
  const byAddressSpecs = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const byPhoto = new Map<string, string>();
  const byDesc = new Map<string, string>();
  const descNeighborhoods = new Map<string, Set<string>>();
  const descListings = new Map<string, string[]>();

  for (const c of candidates) {
    // exact: canonical original URL — unless the two records name different
    // units. Some portals (e.g. SF's DAHLIA) expose one building page that
    // covers several unit types; each is a distinct listing sharing that URL,
    // not a duplicate. The same unit guard every other signal uses applies here.
    if (c.originalUrl) {
      const canonical = canonicalizeListingUrl(c.originalUrl);
      if (canonical) {
        const prev = byCanonicalUrl.get(canonical);
        const prevCand = prev ? byId.get(prev) : undefined;
        if (prev && prev !== c.id && prevCand && !unitsConflict(prevCand, c)) {
          uf.union(prev, c.id, "same_canonical_url");
        } else if (!prev) {
          byCanonicalUrl.set(canonical, c.id);
        }
      }
    }

    // high: normalized address + unit (address needs a unit or street number)
    const unit = effectiveUnit(c);
    const addrKey = normalizeAddressKey(c.addressNormalized ?? c.addressRaw, unit);
    if (addrKey && (unit || /\d/.test(addrKey))) {
      const prev = byAddressUnit.get(addrKey);
      if (prev && prev !== c.id) uf.union(prev, c.id, "same_address_unit");
      else byAddressUnit.set(addrKey, c.id);
    }

    // high: address + price + beds + baths (skip when units explicitly differ —
    // big buildings list many identically-priced units)
    const addrOnly = addressOnlyKey(c);
    if (
      addrOnly &&
      c.priceMonthly != null &&
      c.bedrooms != null &&
      c.bathrooms != null
    ) {
      const specsKey = `${addrOnly}|${c.priceMonthly}|${c.bedrooms}|${c.bathrooms}`;
      const prev = byAddressSpecs.get(specsKey);
      const prevCand = prev ? byId.get(prev) : undefined;
      if (prev && prev !== c.id && prevCand && !unitsConflict(prevCand, c)) {
        uf.union(prev, c.id, "same_address_price_beds_baths");
      } else if (!prev) {
        byAddressSpecs.set(specsKey, c.id);
      }
    }

    // low: title + price + neighborhood
    const titleKey = normTitleKey(c);
    if (titleKey) {
      const prev = byTitle.get(titleKey);
      if (prev && prev !== c.id)
        uf.union(prev, c.id, "similar_title_price_neighborhood");
      else byTitle.set(titleKey, c.id);
    }

    // medium: shared photo identity, same source; units must match and
    // addresses must not differ (marketing photos recur across a portfolio)
    for (const url of c.photos ?? []) {
      const pk = `${c.sourceId}|${photoKey(url)}`;
      const prev = byPhoto.get(pk);
      const prevCand = prev ? byId.get(prev) : undefined;
      if (
        prev &&
        prev !== c.id &&
        prevCand &&
        unitsEqual(prevCand, c) &&
        !addressesConflict(prevCand, c)
      ) {
        uf.union(prev, c.id, "same_photo_hash");
      } else if (!prev) {
        byPhoto.set(pk, c.id);
      }
    }

    // medium: same description hash; units and addresses must not conflict
    // (property managers reuse one description across whole portfolios)
    if (c.descriptionHash) {
      const prev = byDesc.get(c.descriptionHash);
      const prevCand = prev ? byId.get(prev) : undefined;
      if (
        prev &&
        prev !== c.id &&
        prevCand &&
        !unitsConflict(prevCand, c) &&
        !addressesConflict(prevCand, c)
      ) {
        uf.union(prev, c.id, "same_description_hash");
      } else if (!prev) {
        byDesc.set(c.descriptionHash, c.id);
      }
      const hoods = descNeighborhoods.get(c.descriptionHash) ?? new Set<string>();
      if (c.neighborhood) hoods.add(c.neighborhood.toLowerCase());
      descNeighborhoods.set(c.descriptionHash, hoods);
      const ids = descListings.get(c.descriptionHash) ?? [];
      ids.push(c.id);
      descListings.set(c.descriptionHash, ids);
    }
  }

  const membersByRoot = new Map<string, string[]>();
  for (const c of candidates) {
    const root = uf.find(c.id);
    (membersByRoot.get(root) ?? membersByRoot.set(root, []).get(root)!).push(c.id);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, ids] of membersByRoot) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const members = sorted.map((id) => byId.get(id)!);
    const reasons = [...(uf.reasons.get(root) ?? [])];

    // Repost pattern: photo/description link between two listings from the
    // same source with different source listing ids.
    const contentLinked =
      reasons.includes("same_photo_hash") ||
      reasons.includes("same_description_hash");
    if (contentLinked) {
      const bySource = new Map<string, Set<string>>();
      for (const m of members) {
        const set = bySource.get(m.sourceId) ?? new Set<string>();
        set.add(m.sourceListingId ?? m.id);
        bySource.set(m.sourceId, set);
      }
      if ([...bySource.values()].some((set) => set.size > 1)) {
        reasons.push("repost_candidate");
      }
    }

    reasons.sort();
    groups.push({
      id:
        "dup_" +
        createHash("sha1").update(sorted.join("|")).digest("hex").slice(0, 12),
      confidence: strongestConfidence(reasons),
      reasons,
      memberIds: sorted,
      primaryListingId: pickPrimary(members),
    });
  }

  const crossNeighborhoodDescriptionIds = new Set<string>();
  for (const [hash, hoods] of descNeighborhoods) {
    if (hoods.size > 1) {
      for (const id of descListings.get(hash) ?? []) {
        crossNeighborhoodDescriptionIds.add(id);
      }
    }
  }

  return { groups, crossNeighborhoodDescriptionIds };
}
