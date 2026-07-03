/**
 * Light-touch curation from remembered dislikes.
 *
 * The idea, kept deliberately simple so it never over-indexes: look at the
 * characteristics of every apartment the user thumbs-downed, find the ones that
 * RECUR across several of them (an "aversion" — e.g. carpet showing up in three
 * disliked listings), and prefer matches that share the FEWEST of those. Drop a
 * match only when it hits a *strong* (very common) aversion. A single dislike,
 * or a trait that appears once, changes nothing.
 *
 * This is the same judgment Porter (the managed agent) applies to its nightly
 * shortlist from the mounted memory store; here it runs deterministically over
 * the local disliked set so the app can curate instantly and offline.
 */

export interface Aversion {
  /** namespaced characteristic tag, e.g. "flooring:carpet" */
  tag: string;
  /** how many disliked apartments share it */
  count: number;
  /** total disliked apartments considered */
  total: number;
  /** count / total — how consistently the user dislikes it (0–1) */
  strength: number;
}

/** Need at least this many dislikes before curating at all — stays quiet early. */
export const MIN_DISLIKES_TO_CURATE = 3;
/** A trait this consistent among dislikes is confident enough to filter on. */
export const STRONG_AVERSION = 0.6;

/**
 * The recurring characteristics of the disliked set. A tag becomes an aversion
 * when it appears in at least ~40% of dislikes (and at least twice), so
 * one-offs are ignored. Returns [] until there are enough dislikes to be sure.
 */
export function inferAversions(
  tagSets: string[][],
  opts: { minDislikes?: number } = {},
): Aversion[] {
  const minDislikes = opts.minDislikes ?? MIN_DISLIKES_TO_CURATE;
  const total = tagSets.length;
  if (total < minDislikes) return [];

  const counts = new Map<string, number>();
  for (const set of tagSets) {
    for (const tag of new Set(set)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const minCount = Math.max(2, Math.ceil(total * 0.4));
  const aversions: Aversion[] = [];
  for (const [tag, count] of counts) {
    if (count >= minCount) {
      aversions.push({ tag, count, total, strength: count / total });
    }
  }
  // Most-consistent aversions first.
  aversions.sort((a, b) => b.strength - a.strength || b.count - a.count);
  return aversions;
}

export interface Curatable<T> {
  item: T;
  tags: string[];
}

export interface CurationResult<T> {
  /** matches, best-fit (fewest shared aversions) first; strong-aversion hits removed */
  kept: T[];
  /** how many matches were dropped for hitting a strong aversion */
  removed: number;
}

/**
 * Re-rank matches by how few remembered aversions they share, dropping the ones
 * that hit a *strong* aversion. Never empties the list purely from curation —
 * if every candidate hits a strong aversion, they're all kept but still ranked.
 */
export function curateMatches<T>(
  items: Array<Curatable<T>>,
  aversions: Aversion[],
): CurationResult<T> {
  if (aversions.length === 0) return { kept: items.map((i) => i.item), removed: 0 };

  const byTag = new Map(aversions.map((a) => [a.tag, a]));
  const scored = items.map((ci) => {
    const shared = ci.tags.map((t) => byTag.get(t)).filter((a): a is Aversion => a != null);
    return {
      item: ci.item,
      sharedCount: shared.length,
      hitsStrong: shared.some((a) => a.strength >= STRONG_AVERSION),
    };
  });

  let survivors = scored.filter((s) => !s.hitsStrong);
  if (survivors.length === 0) survivors = scored; // safety: don't curate to nothing
  const removed = items.length - survivors.length;
  // Stable sort keeps original (freshness) order among equal shared-counts.
  survivors.sort((a, b) => a.sharedCount - b.sharedCount);
  return { kept: survivors.map((s) => s.item), removed };
}

/**
 * A tiny, non-preachy note for the Porter UI when curation is active. Names the
 * single most-consistent aversion as a for-instance and stops there.
 */
export function curationNote(aversions: Aversion[]): string | null {
  if (aversions.length === 0) return null;
  return `Tuned to what you’ve passed on`;
}
