import { createHash } from "node:crypto";
import { photoKey } from "./hash";
import { normalizeAddressKey } from "./normalize";

/**
 * Deterministic duplicate detection within and across sources.
 * Signals (any one links two listings into the same group):
 *   - same normalized address + public unit number
 *   - same normalized title + price + neighborhood
 *   - shared photo identity key AND matching unit numbers (catches
 *     Craigslist reposts without merging different units of one building,
 *     which legitimately share building/amenity photos on PM sites)
 *   - same description hash, unless the two listings have explicitly
 *     different unit numbers (PM sites reuse per-building boilerplate)
 * Photo-URL identity only works within a source (different sites host
 * different copies of an image) — a documented phase-one limitation.
 */

export interface DupeCandidate {
  id: string;
  sourceId: string;
  title: string | null;
  priceMonthly: number | null;
  neighborhood: string | null;
  addressRaw: string | null;
  addressNormalized: string | null;
  unitNumberPublic: string | null;
  photos: string[] | null;
  descriptionHash: string | null;
}

export interface DuplicateGroup {
  id: string;
  reasons: string[];
  memberIds: string[];
}

export interface DedupeResult {
  groups: DuplicateGroup[];
  /** listing ids whose description hash also appears in a different neighborhood (scam signal) */
  crossNeighborhoodDescriptionIds: Set<string>;
}

class UnionFind {
  private parent = new Map<string, string>();
  reasons = new Map<string, Set<string>>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string, reason: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    const key = ra === rb ? ra : rb;
    if (ra !== rb) this.parent.set(ra, rb);
    const root = this.find(key);
    const set = this.reasons.get(root) ?? new Set<string>();
    for (const r of this.reasons.get(ra) ?? []) set.add(r);
    for (const r of this.reasons.get(rb) ?? []) set.add(r);
    set.add(reason);
    this.reasons.set(root, set);
  }
}

function normTitleKey(c: DupeCandidate): string | null {
  if (!c.title || c.priceMonthly == null || !c.neighborhood) return null;
  const title = c.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (title.length < 8) return null;
  return `${title}|${c.priceMonthly}|${c.neighborhood.toLowerCase()}`;
}

const unitKey = (unit: string | null): string | null =>
  unit ? unit.toLowerCase().replace(/[^a-z0-9]/g, "") || null : null;

/** true when both listings name a unit and the units differ */
function unitsConflict(a: DupeCandidate, b: DupeCandidate): boolean {
  const ua = unitKey(a.unitNumberPublic);
  const ub = unitKey(b.unitNumberPublic);
  return ua != null && ub != null && ua !== ub;
}

function unitsEqual(a: DupeCandidate, b: DupeCandidate): boolean {
  return unitKey(a.unitNumberPublic) === unitKey(b.unitNumberPublic);
}

export function detectDuplicates(candidates: DupeCandidate[]): DedupeResult {
  const uf = new UnionFind();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const byAddress = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const byPhoto = new Map<string, string>();
  const byDesc = new Map<string, string>();
  const descNeighborhoods = new Map<string, Set<string>>();
  const descListings = new Map<string, string[]>();

  for (const c of candidates) {
    const addrKey = normalizeAddressKey(
      c.addressNormalized ?? c.addressRaw,
      c.unitNumberPublic,
    );
    // Address alone (no unit) is too coarse for big buildings — require a unit
    // suffix or an address that includes a street number to link on it.
    if (addrKey && (c.unitNumberPublic || /\d/.test(addrKey))) {
      const prev = byAddress.get(addrKey);
      if (prev) uf.union(prev, c.id, "same_address_unit");
      else byAddress.set(addrKey, c.id);
    }
    const titleKey = normTitleKey(c);
    if (titleKey) {
      const prev = byTitle.get(titleKey);
      if (prev) uf.union(prev, c.id, "same_title_price_neighborhood");
      else byTitle.set(titleKey, c.id);
    }
    for (const url of c.photos ?? []) {
      const pk = `${c.sourceId}|${photoKey(url)}`;
      const prev = byPhoto.get(pk);
      const prevCand = prev ? byId.get(prev) : undefined;
      if (prev && prev !== c.id && prevCand && unitsEqual(prevCand, c)) {
        uf.union(prev, c.id, "shared_photos");
      } else if (!prev) {
        byPhoto.set(pk, c.id);
      }
    }
    if (c.descriptionHash) {
      const prev = byDesc.get(c.descriptionHash);
      const prevCand = prev ? byId.get(prev) : undefined;
      if (prev && prevCand && !unitsConflict(prevCand, c)) {
        uf.union(prev, c.id, "same_description");
      } else if (!prev) {
        byDesc.set(c.descriptionHash, c.id);
      }
      const hoods =
        descNeighborhoods.get(c.descriptionHash) ?? new Set<string>();
      if (c.neighborhood) hoods.add(c.neighborhood.toLowerCase());
      descNeighborhoods.set(c.descriptionHash, hoods);
      const ids = descListings.get(c.descriptionHash) ?? [];
      ids.push(c.id);
      descListings.set(c.descriptionHash, ids);
    }
  }

  const members = new Map<string, string[]>();
  for (const c of candidates) {
    const root = uf.find(c.id);
    (members.get(root) ?? members.set(root, []).get(root)!).push(c.id);
  }
  const groups: DuplicateGroup[] = [];
  for (const [root, ids] of members) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const groupId =
      "dup_" +
      createHash("sha1").update(sorted.join("|")).digest("hex").slice(0, 12);
    groups.push({
      id: groupId,
      reasons: [...(uf.reasons.get(root) ?? [])].sort(),
      memberIds: sorted,
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
