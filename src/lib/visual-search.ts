/**
 * Natural-language visual search matching, offline and deterministic.
 *
 * The user types something like "hardwood floors and bay windows". We treat
 * that as an AND of feature phrases: each phrase must be present in the
 * listing's vision search text (the lowercased blob of features + summary +
 * room notes produced by the vision layer). This keeps search instant and
 * local — no embeddings, no per-keystroke API calls — while still feeling
 * natural for the "features I care about" queries this is built for.
 */

/** Split a free-text query into the phrases that must all be present. */
export function parseVisualQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Split on commas, ampersands, plus, and the words "and"/"with".
  const phrases = q
    .split(/\s*(?:,|&|\+|\band\b|\bwith\b)\s*/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return phrases.length > 0 ? phrases : [q];
}

/** Does one phrase appear in the search text (whole phrase, or all its words)? */
function phraseMatches(searchText: string, phrase: string): boolean {
  if (searchText.includes(phrase)) return true;
  // Fall back to requiring every meaningful word of the phrase to appear
  // somewhere, so "hardwood bay window" still matches "... hardwood floors ...
  // bay windows ...". Drop very short filler words.
  const words = phrase.split(/\s+/).filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => searchText.includes(w));
}

/**
 * True when the listing's vision search text satisfies the query (every parsed
 * phrase present). An empty query matches everything; a non-empty query never
 * matches a listing that hasn't been vision-analyzed (null/empty search text).
 */
export function matchesVisualQuery(
  searchText: string | null | undefined,
  query: string,
): boolean {
  const phrases = parseVisualQuery(query);
  if (phrases.length === 0) return true;
  if (!searchText) return false;
  const hay = searchText.toLowerCase();
  return phrases.every((p) => phraseMatches(hay, p));
}
