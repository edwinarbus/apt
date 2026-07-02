import * as cheerio from "cheerio";
import { sha256Hex } from "@/core/hash";
import {
  computeEffectiveMonthly,
  extractConcessions,
  htmlToText,
  normalizeLaundry,
  normalizeParking,
  parseBathrooms,
  parseBedrooms,
  parsePrice,
  parseSquareFeet,
} from "@/core/normalize";
import { matchNeighborhood } from "@/core/neighborhoods";
import type { NormalizedListing } from "@/core/types";
import type {
  AdapterContext,
  AdapterRunResult,
  SourceAdapter,
} from "./types";
import { emptyRunResult } from "./types";

/**
 * RentSFNow adapter (SF property-manager direct inventory).
 *
 * Strategy (verified against the live site, 2026-07):
 * - The public search page is WordPress; its own frontend POSTs to
 *   /wp-admin/admin-ajax.php with action=wpas_ajax_load and receives
 *   server-rendered result HTML. We call the same endpoint with the same
 *   parameters a browser would send, filtered to San Francisco.
 * - Each response embeds `last_page` / `current_page` hidden inputs, giving
 *   trustworthy pagination completeness, and a Google-Maps `markers` array
 *   with building-level coordinates keyed by street address.
 * - Unit detail pages (/apartments/rental/<slug>) are server-rendered and add
 *   square footage, description, amenities and the photo gallery. Detail
 *   pages are fetched only for new/changed units, capped per run.
 */

const AJAX_PATH = "/wp-admin/admin-ajax.php";

export interface RsnCard {
  postId: string;
  url: string;
  neighborhoodRaw: string | null;
  addressRaw: string | null;
  unitNumberPublic: string | null;
  infoRaw: string | null;
  photoUrl: string | null;
  dogIcon: boolean;
  catIcon: boolean;
}

export interface RsnResultsPage {
  cards: RsnCard[];
  currentPage: number | null;
  lastPage: number | null;
  /** building coordinates keyed by normalized street address */
  markers: Map<string, { lat: number; lng: number }>;
}

const normalizeMarkerKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseRsnResultsPage(
  html: string,
  baseUrl: string,
): RsnResultsPage {
  const $ = cheerio.load(html);
  const cards: RsnCard[] = [];

  $("div.searchListingContainer[id^=post-]").each((_, el) => {
    const card = $(el);
    const postId = (card.attr("id") ?? "").replace("post-", "");
    const href = card.find("a[href]").first().attr("href");
    if (!postId || !href) return;
    const url = href.startsWith("http") ? href : `${baseUrl}${href}`;

    const h2 = card.find("h2").first().text().replace(/\s+/g, " ").trim();
    let addressRaw: string | null = h2 || null;
    let unit: string | null = null;
    const unitMatch = h2.match(/^(.*?)\s*#\s*(\S+)$/);
    if (unitMatch) {
      addressRaw = unitMatch[1].trim();
      unit = unitMatch[2];
    }

    const style = card.find(".imageCover").first().attr("style") ?? "";
    // RentCafe filenames legitimately contain parens, e.g. "...-01(1).jpg",
    // so prefer the quoted form and never stop at ")".
    const bg =
      style.match(/background-image\s*:\s*url\(\s*['"]([^'"]+)['"]/) ??
      style.match(/background-image\s*:\s*url\(([^)]+)\)/);

    cards.push({
      postId,
      url,
      neighborhoodRaw:
        card.find("h3").first().text().replace(/\s+/g, " ").trim() || null,
      addressRaw,
      unitNumberPublic: unit,
      infoRaw:
        card.find(".apartment-info").first().text().replace(/\s+/g, " ").trim() ||
        null,
      photoUrl: bg ? bg[1] : null,
      dogIcon: card.find("li.dog").length > 0,
      catIcon: card.find("li.cat").length > 0,
    });
  });

  const readHidden = (name: string): number | null => {
    const v = $(`input[name=${name}]`).attr("value");
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined ? n : null;
  };

  const markers = new Map<string, { lat: number; lng: number }>();
  const markersMatch = html.match(/markers\s*=\s*\[([\s\S]*?)\];/);
  if (markersMatch) {
    const entryRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(markersMatch[1]))) {
      const address = m[1].replace(/\\(['"])/g, "$1");
      const lat = Number(m[2]);
      const lng = Number(m[3]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        markers.set(normalizeMarkerKey(address), { lat, lng });
      }
    }
  }

  return {
    cards,
    currentPage: readHidden("current_page"),
    lastPage: readHidden("last_page"),
    markers,
  };
}

/** "Studio \\ 1 Bath \\ $1,795" -> { bedsRaw, bathsRaw, priceRaw } */
export function parseRsnInfo(infoRaw: string | null): {
  bedsRaw: string | null;
  bathsRaw: string | null;
  priceRaw: string | null;
} {
  if (!infoRaw) return { bedsRaw: null, bathsRaw: null, priceRaw: null };
  const parts = infoRaw
    .split(/\s*\\+\s*|\s*\/\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  let bedsRaw: string | null = null;
  let bathsRaw: string | null = null;
  let priceRaw: string | null = null;
  for (const part of parts) {
    if (/studio|bed/i.test(part)) bedsRaw ??= part;
    else if (/bath/i.test(part)) bathsRaw ??= part;
    else if (/\$/.test(part)) priceRaw ??= part;
  }
  return { bedsRaw, bathsRaw, priceRaw };
}

export interface RsnDetail {
  squareFeetRaw: string | null;
  description: string | null;
  rawDescription: string | null;
  amenities: string[];
  photos: string[];
  availabilityRaw: string | null;
  depositRaw: string | null;
}

export function parseRsnDetailPage(html: string): RsnDetail {
  const $ = cheerio.load(html);
  const bodyText = $("main").text() || $("body").text();

  const sqftMatch = bodyText.match(/([\d,]{2,6})\s*sq\.?\s*ft|([\d,]{2,6})\s*sqft/i);
  const descriptionEl = $(".apt-description").first();
  const amenities: string[] = [];
  $(".apt-amenities li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) amenities.push(text);
  });

  const photos: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | undefined | null) => {
    if (!u) return;
    // Filenames contain parens ("…-01(1).jpg") — trim quotes/whitespace only.
    const clean = u.trim().replace(/^['"]|['"]$/g, "");
    if (!/^https:\/\/cdn\.rentcafe\.com\//i.test(clean)) return;
    if (!seen.has(clean)) {
      seen.add(clean);
      photos.push(clean);
    }
  };
  $("[class*=Carousel], [class*=carousel], [class*=gallery], [class*=Gallery]")
    .find("img[src], [style*=background-image]")
    .each((_, el) => {
      push($(el).attr("src"));
      const style = $(el).attr("style") ?? "";
      const bg =
        style.match(/url\(\s*['"]([^'"]+)['"]/) ?? style.match(/url\(([^)]+)\)/);
      push(bg?.[1]);
    });
  if (photos.length === 0) {
    const re = /https:\/\/cdn\.rentcafe\.com\/[^\s"'<>]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && photos.length < 20) push(m[0]);
  }

  const availMatch = bodyText.match(
    /available\s*(?:on|date)?:?\s*(now|\d{1,2}\/\d{1,2}\/\d{2,4}|[a-z]{3,9}\.?\s+\d{1,2})/i,
  );
  const depositMatch = bodyText.match(/deposit:?\s*\$?([\d,]+)/i);

  return {
    squareFeetRaw: sqftMatch ? `${(sqftMatch[1] ?? sqftMatch[2]).trim()} sqft` : null,
    description: htmlToText(descriptionEl.html()) ?? null,
    rawDescription: descriptionEl.html() ?? null,
    amenities,
    photos,
    availabilityRaw: availMatch ? availMatch[1] : null,
    depositRaw: depositMatch ? `$${depositMatch[1]}` : null,
  };
}

function buildListing(
  card: RsnCard,
  markers: Map<string, { lat: number; lng: number }>,
  detail: RsnDetail | null,
): NormalizedListing {
  const { bedsRaw, bathsRaw, priceRaw } = parseRsnInfo(card.infoRaw);
  const hood = matchNeighborhood(card.neighborhoodRaw);
  const marker = card.addressRaw
    ? markers.get(normalizeMarkerKey(card.addressRaw))
    : undefined;
  const priceMonthly = parsePrice(priceRaw);

  const base: NormalizedListing = {
    sourceListingId: card.postId,
    originalUrl: card.url,
    title: card.addressRaw
      ? `${card.addressRaw}${card.unitNumberPublic ? ` #${card.unitNumberPublic}` : ""}`
      : `RentSFNow unit ${card.postId}`,
    fetchDepth: detail ? "detail" : "card",
    addressRaw: card.addressRaw,
    unitNumberPublic: card.unitNumberPublic,
    neighborhood: hood?.name ?? null,
    sourceNeighborhoodRaw: card.neighborhoodRaw,
    city: "San Francisco",
    state: "CA",
    latitude: marker?.lat ?? null,
    longitude: marker?.lng ?? null,
    geocodePrecision: marker ? "building" : null,
    priceRaw,
    priceMonthly,
    bedroomsRaw: bedsRaw,
    bedrooms: parseBedrooms(bedsRaw),
    bathroomsRaw: bathsRaw,
    bathrooms: parseBathrooms(bathsRaw),
    catsAllowed: card.catIcon ? true : null,
    dogsAllowed: card.dogIcon ? true : null,
    photos: card.photoUrl ? [card.photoUrl] : [],
    primaryPhotoUrl: card.photoUrl,
    propertyType: "apartment",
    listingType: "rent",
    rawPayload: { card },
  };
  if (!detail) return base;

  const amenityText = detail.amenities.join("\n");
  const laundryRaw = detail.amenities.find((a) => normalizeLaundry(a)) ?? null;
  const parkingRaw = detail.amenities.find((a) => normalizeParking(a)) ?? null;
  const concessionsRaw =
    extractConcessions(detail.description) ??
    extractConcessions(amenityText);

  return {
    ...base,
    fetchDepth: "detail",
    description: detail.description,
    rawDescription: detail.rawDescription,
    squareFeetRaw: detail.squareFeetRaw,
    squareFeet: parseSquareFeet(detail.squareFeetRaw),
    concessionsRaw,
    priceEffectiveMonthly: computeEffectiveMonthly(priceMonthly, concessionsRaw),
    depositRaw: detail.depositRaw,
    depositAmount: parsePrice(detail.depositRaw),
    photos: detail.photos.length > 0 ? detail.photos : base.photos,
    primaryPhotoUrl: detail.photos[0] ?? base.primaryPhotoUrl,
    amenitiesRaw: detail.amenities,
    amenitiesNormalized: detail.amenities.map((a) => a.toLowerCase()),
    laundryRaw,
    laundryNormalized: normalizeLaundry(laundryRaw ?? amenityText),
    parkingRaw,
    parkingNormalized: normalizeParking(parkingRaw ?? amenityText),
    rawPayload: { card, detail: { ...detail, photos: undefined } },
  };
}

export const rentSfNowAdapter: SourceAdapter = {
  adapterType: "rentsfnow",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const baseUrl = ctx.source.baseUrl ?? "https://www.rentsfnow.com";
    const ajaxUrl = `${baseUrl}${AJAX_PATH}`;

    const formBody = (page: number) =>
      new URLSearchParams({
        action: "wpas_ajax_load",
        page: String(page),
        type: "search",
        city: "San Francisco",
        neighborhood: "",
        bedrooms: "",
        bathrooms: "",
        price: "500,20000",
        minprice: "500",
        maxprice: "20000",
        sort: "post_date-desc",
        view: "list",
        pathName: "available-apartments",
      }).toString();

    const allCards: RsnCard[] = [];
    const markers = new Map<string, { lat: number; lng: number }>();
    let lastPage: number | null = null;
    let pagesFetched = 0;

    const maxPages = ctx.source.maxPagesPerRun;
    for (let page = 1; page <= (lastPage ?? maxPages); page++) {
      if (page > maxPages) break;
      const res = await ctx.fetcher.fetchText(ajaxUrl, {
        method: "POST",
        body: formBody(page),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${baseUrl}/search/`,
        },
      });
      if (!res.ok) {
        result.pageTrace.push({
          page,
          url: `${ajaxUrl} (page ${page})`,
          httpStatus: res.status,
          listingsExtracted: 0,
          note: res.error ?? undefined,
        });
        if (page === 1) {
          result.fatalError = `results endpoint failed: ${res.error}`;
          result.pagesVisited = 1;
          return result;
        }
        result.warnings.push(`page ${page} fetch failed: ${res.error}`);
        result.paginationCompleted = false;
        break;
      }
      pagesFetched++;
      if (page === 1) {
        result.htmlHash = sha256Hex(res.text);
        ctx.saveDebug("results-page-1.html", res.text);
      }
      const parsed = parseRsnResultsPage(res.text, baseUrl);
      lastPage ??= parsed.lastPage;
      for (const [k, v] of parsed.markers) markers.set(k, v);
      allCards.push(...parsed.cards);
      result.pageTrace.push({
        page,
        url: `${ajaxUrl} (page ${page})`,
        httpStatus: res.status,
        listingsExtracted: parsed.cards.length,
        note: `last_page=${parsed.lastPage ?? "?"}`,
      });
      if (parsed.cards.length === 0 && page === 1) {
        result.fatalError =
          "zero results parsed from page 1 — source structure may have changed";
        result.pagesVisited = pagesFetched;
        return result;
      }
      if (parsed.lastPage != null && page >= parsed.lastPage) break;
      if (parsed.lastPage == null && parsed.cards.length === 0) break;
    }
    result.pagesVisited = pagesFetched;

    if (lastPage != null) {
      if (pagesFetched >= lastPage) {
        result.paginationCompleted = true;
      } else {
        result.paginationCompleted = false;
        result.warnings.push(
          `pagination stopped at page ${pagesFetched} of ${lastPage} (maxPagesPerRun=${maxPages})`,
        );
      }
    } else {
      result.paginationCompleted = null;
      result.warnings.push(
        "source did not report last_page; pagination completeness unknown",
      );
    }

    // Dedupe cards by post id (map view can repeat listings inside a page).
    const cardById = new Map<string, RsnCard>();
    for (const c of allCards) cardById.set(c.postId, c);
    const cards = [...cardById.values()];

    interface Planned {
      card: RsnCard;
      needsDetail: boolean;
    }
    const planned: Planned[] = cards.map((card) => {
      const known = ctx.knownListings.get(card.postId);
      const { priceRaw } = parseRsnInfo(card.infoRaw);
      const cardPrice = parsePrice(priceRaw);
      return {
        card,
        needsDetail:
          !known ||
          !known.detailFetchedAt ||
          (cardPrice != null && known.priceMonthly !== cardPrice),
      };
    });

    const needingDetail = planned.filter((p) => p.needsDetail);
    const budget = ctx.source.maxDetailPagesPerRun;
    const toFetch = needingDetail.slice(0, budget);
    if (needingDetail.length > toFetch.length) {
      result.warnings.push(
        `detail budget exhausted: ${needingDetail.length} units need detail pages, cap is ${budget}`,
      );
    }
    ctx.log(
      `rentsfnow: ${cards.length} unique cards over ${pagesFetched} pages, fetching ${toFetch.length} detail pages`,
    );

    const detailByPostId = new Map<string, RsnDetail>();
    for (const p of toFetch) {
      const res = await ctx.fetcher.fetchText(p.card.url);
      result.detailPagesVisited++;
      if (!res.ok) {
        result.detailFetchFailures++;
        result.warnings.push(`detail fetch failed for ${p.card.url}: ${res.error}`);
        continue;
      }
      detailByPostId.set(p.card.postId, parseRsnDetailPage(res.text));
    }
    result.detailExtractionCompleted =
      result.detailFetchFailures === 0 && needingDetail.length === toFetch.length;

    for (const p of planned) {
      result.listings.push(
        buildListing(p.card, markers, detailByPostId.get(p.card.postId) ?? null),
      );
    }
    return result;
  },
};
