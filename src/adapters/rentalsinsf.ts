import { sha256Hex } from "@/core/hash";
import {
  parseBathrooms,
  parseBedrooms,
  parsePrice,
  parseSquareFeet,
} from "@/core/normalize";
import { isSfLocation } from "@/core/neighborhoods";
import type { NormalizedListing } from "@/core/types";
import type { AdapterContext, AdapterRunResult, SourceAdapter } from "./types";
import { emptyRunResult } from "./types";

/**
 * Rentals in SF (rentalsinsf.com) — a long-running San Francisco rental
 * brokerage. WordPress site with a public `rental` custom post type.
 *
 * Data path (verified 2026-07-03, plain HTTP, no browser):
 *   GET /wp-json/wp/v2/rental?per_page=100&_embed → every current listing with
 *   its title (address), permalink, full description HTML, amenity taxonomy,
 *   and an embedded featured photo. Price / beds / baths live in the prose, so
 *   they're extracted best-effort from the description (null when not stated);
 *   the address + neighborhood come from the title/description and are geocoded.
 *
 * robots.txt allows everything except /wp-admin (Crawl-delay: 10).
 */

const RENTAL_PATH = "/wp-json/wp/v2/rental?per_page=100&_embed";

function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;|&apos;|&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Rent, beds, and baths live only on the server-rendered detail page — the WP
 * API omits them. Rent is in `rent_amt`; beds/baths are in the Easy Property
 * Listings meta block (`<span title="Bedrooms" …><span class="icon-value">3…`),
 * which is authoritative and handles half-baths ("1.5"). The agency's own office
 * page has none of these, so a null price is the signal that a post isn't a real
 * rental.
 */
function extractDetailFacts(html: string): {
  rent: number | null;
  beds: number | null;
  baths: number | null;
} {
  const rentM =
    html.match(/rent_amt"[^>]*>\s*\$?\s*([\d,]+)/i) ??
    html.match(/class="[^"]*\bprice\b[^"]*"[^>]*>\s*\$?\s*([\d,]+)/i);
  let rent = rentM ? parsePrice(rentM[1]) : null;
  if (rent != null && (rent < 800 || rent > 40000)) rent = null;

  const metaNum = (label: string): number | null => {
    const m = html.match(
      new RegExp(
        `title="${label}"[^>]*>\\s*<span[^>]*class="icon-value"[^>]*>\\s*([\\d.]+)`,
        "i",
      ),
    );
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 && n < 20 ? n : null;
  };
  return { rent, beds: metaNum("Bedrooms"), baths: metaNum("Bathrooms") };
}

interface RentalPost {
  id: number;
  slug?: string;
  link?: string;
  status?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  _embedded?: { "wp:featuredmedia"?: Array<{ source_url?: string }> };
}

export function buildListingFromRental(post: RentalPost): NormalizedListing | null {
  const link = post.link?.trim();
  if (!link || post.status === "trash") return null;

  // The brokerage also lists Marin/Peninsula rentals; this is an SF-only app.
  // The permalink slug ends in the locality ("…-outer-richmond-san-francisco",
  // "…-greenbrae"), so de-slug the tail and keep only San Francisco addresses.
  const localityText = (link.replace(/\/+$/, "").split("/").pop() ?? "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ");
  if (!isSfLocation(localityText)) return null;

  const title = decodeEntities(post.title?.rendered ?? "").trim();
  const body = stripHtml(post.content?.rendered ?? post.excerpt?.rendered ?? "");
  const haystack = `${title} ${body}`;

  // Price: first "$1,234"-style figure in the 800–20000 range.
  let priceMonthly: number | null = null;
  let priceRaw: string | null = null;
  for (const m of haystack.matchAll(/\$\s?([\d,]{3,6})(?:\s?\/\s?mo|\s?per\s?month)?/gi)) {
    const n = parsePrice(m[1]);
    if (n != null && n >= 800 && n <= 25000) {
      priceMonthly = n;
      priceRaw = m[0].trim();
      break;
    }
  }

  // Beds / baths from prose.
  const bedText = haystack.match(/\bstudio\b/i)
    ? "studio"
    : (haystack.match(/(\d+)\s*(?:bed|bedroom|br|bdr?m?s?)\b/i)?.[0] ?? null);
  const bathText = haystack.match(/(\d+(?:\.\d)?)\s*(?:full\s+)?(?:bath|ba\b|bathroom)/i)?.[0] ?? null;
  const sqftText = haystack.match(/([\d,]{3,5})\s*(?:sq\.?\s?ft|sqft|square\s?f)/i)?.[0] ?? null;

  // These posts are address-only; the description freely name-drops *other*
  // neighborhoods ("minutes to the Financial District"), which fooled a prose
  // match. Leave the neighborhood null and let the geocoder + polygon reverse-
  // lookup assign the one the address actually sits in.
  const photo = post._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null;

  return {
    sourceListingId: String(post.id),
    originalUrl: link,
    title: title || `Rentals in SF listing ${post.id}`,
    fetchDepth: "detail",
    description: body || null,
    rawDescription: body || null,
    // The title is the street address for this source.
    addressRaw: title || null,
    neighborhood: null,
    sourceNeighborhoodRaw: null,
    city: "San Francisco",
    state: "CA",
    latitude: null,
    longitude: null,
    geocodePrecision: null,
    priceRaw,
    priceMonthly,
    bedroomsRaw: bedText,
    bedrooms: bedText ? parseBedrooms(bedText) : null,
    bathroomsRaw: bathText,
    bathrooms: bathText ? parseBathrooms(bathText) : null,
    squareFeetRaw: sqftText,
    squareFeet: sqftText ? parseSquareFeet(sqftText) : null,
    propertyType: "apartment",
    listingType: "rent",
    photos: photo ? [photo] : [],
    primaryPhotoUrl: photo,
    contactUrl: link,
    applicationUrl: link,
    listingStatus: "active",
    rawPayload: { rentalsinsf: { id: post.id, slug: post.slug } },
  };
}

export const rentalsInSfAdapter: SourceAdapter = {
  adapterType: "rentalsinsf",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const baseUrl = ctx.source.baseUrl ?? "https://www.rentalsinsf.com";
    const url = `${baseUrl}${RENTAL_PATH}`;

    const res = await ctx.fetcher.fetchText(url, { headers: { Accept: "application/json" } });
    result.pagesVisited = 1;
    if (!res.ok) {
      result.fatalError = `Rentals in SF fetch failed: ${res.error}`;
      return result;
    }

    let posts: RentalPost[];
    try {
      const parsed = JSON.parse(res.text);
      posts = Array.isArray(parsed) ? (parsed as RentalPost[]) : [];
    } catch (err) {
      result.fatalError = `could not parse Rentals in SF response: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    result.totalListingsReportedBySource = posts.length;
    if (posts.length === 0) {
      result.fatalError = "Rentals in SF returned zero listings";
      result.paginationCompleted = false;
      return result;
    }

    const bySourceId = new Map<string, NormalizedListing>();
    const budget = ctx.source.maxDetailPagesPerRun;
    for (const post of posts) {
      const listing = buildListingFromRental(post);
      if (!listing || bySourceId.has(listing.sourceListingId)) continue;
      // The agency's own "Rentals In SF!" office page rides the same feed —
      // it's not an apartment. Drop it by brand title (and, below, by no price).
      if (/^rentals\s+in\s+sf\b/i.test(listing.title)) continue;

      // Rent + beds/baths are only on the detail page (the API omits them), so
      // fetch it within the polite budget and let those structured facts win
      // over the best-effort prose parse.
      const known = ctx.knownListings.get(listing.sourceListingId);
      if (result.detailPagesVisited < budget) {
        const detailRes = await ctx.fetcher.fetchText(listing.originalUrl);
        result.detailPagesVisited++;
        if (detailRes.ok) {
          const f = extractDetailFacts(detailRes.text);
          if (f.rent != null) {
            listing.priceMonthly = f.rent;
            listing.priceRaw = `$${f.rent.toLocaleString()}/mo`;
          }
          if (f.beds != null) {
            listing.bedrooms = f.beds;
            listing.bedroomsRaw = f.beds === 0 ? "studio" : `${f.beds} bd`;
          }
          if (f.baths != null) {
            listing.bathrooms = f.baths;
            listing.bathroomsRaw = `${f.baths} ba`;
          }
        } else {
          result.detailFetchFailures++;
          result.warnings.push(`detail fetch failed for ${listing.originalUrl}: ${detailRes.error}`);
        }
      } else if (known?.priceMonthly != null) {
        listing.priceMonthly = known.priceMonthly;
      }

      // A real listing always posts rent; a priceless post is the office page
      // or a broken draft. Drop it rather than show "— /mo · ? bd" in the rail.
      if (listing.priceMonthly == null) continue;

      bySourceId.set(listing.sourceListingId, listing);
    }

    result.listings = [...bySourceId.values()];
    result.htmlHash = sha256Hex(res.text);
    result.paginationCompleted = true;
    result.detailExtractionCompleted = true;
    result.pageTrace.push({
      page: 1,
      url,
      httpStatus: res.status,
      listingsExtracted: result.listings.length,
      note: `${posts.length} rental posts → ${result.listings.length} listings`,
    });
    ctx.log(`rentalsinsf: ${posts.length} posts → ${result.listings.length} listings`);

    if (result.listings.length === 0) {
      result.fatalError = "zero listings extracted from Rentals in SF";
      result.paginationCompleted = false;
    }
    return result;
  },
};
