/**
 * Listing-URL canonicalization for dedupe. Two URLs that canonicalize equal
 * are treated as the same listing (confidence: exact), so this must strip
 * only what genuinely never identifies a listing:
 *  - known tracking params (utm_*, fbclid, gclid, …)
 *  - fragments
 *  - default ports, duplicate slashes, trailing slash (except root)
 *  - scheme/host casing
 * Identifying query params are preserved — some sources address listings via
 * query string, and over-normalizing would merge different listings.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "referrer",
  "spm",
  "cmpid",
  "campaign_id",
  "share_id",
  "vgo_ee",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

export function canonicalizeListingUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  return url.toString();
}
