import * as cheerio from "cheerio";
import { sha256Hex } from "@/core/hash";
import {
  computeEffectiveMonthly,
  extractConcessions,
  extractUnitFromTitle,
  htmlToText,
  normalizeLaundry,
  normalizeParking,
  parseBathrooms,
  parseBedrooms,
  parsePetPolicy,
  parsePrice,
  parseSquareFeet,
} from "@/core/normalize";
import { isSfLocation, matchNeighborhood } from "@/core/neighborhoods";
import type { ListingStatus, NormalizedListing } from "@/core/types";
import type {
  AdapterContext,
  AdapterRunResult,
  SourceAdapter,
} from "./types";
import { emptyRunResult } from "./types";

/**
 * Craigslist SF apartments adapter.
 *
 * Strategy (verified against live pages, 2026-07):
 * - The search URL serves a static fallback of ~360 newest results as
 *   `li.cl-static-search-result` items (title, price, location, detail URL).
 *   The old `?s=` offset pagination is ignored by this fallback, so one page
 *   is all we can get without driving the JS app — fine for daily monitoring
 *   of fresh inventory, and recorded honestly in the pagination trace.
 * - Results include nearby cities (Oakland etc.); we keep SF-proper only.
 * - Detail pages are classic server-rendered HTML with rich attributes,
 *   coordinates (`#map[data-latitude]`), an address (`.mapaddress`), photos
 *   (`var imgList = [...]`) and posting metadata. We fetch details only for
 *   new or visibly changed listings, capped by maxDetailPagesPerRun.
 * - robots.txt (checked at run time by the runner) currently allows /search
 *   and posting pages.
 */

export interface ClSearchCard {
  title: string;
  url: string;
  priceRaw: string | null;
  locationRaw: string | null;
}

export function parseClSearchPage(html: string): ClSearchCard[] {
  const $ = cheerio.load(html);
  const cards: ClSearchCard[] = [];
  $("li.cl-static-search-result").each((_, el) => {
    const item = $(el);
    const url = item.find("a").first().attr("href");
    const title =
      item.find(".title").first().text().trim() ||
      (item.attr("title") ?? "").trim();
    if (!url || !title) return;
    const priceRaw = item.find(".price").first().text().trim() || null;
    const locationRaw =
      item.find(".location").first().text().replace(/\s+/g, " ").trim() || null;
    cards.push({ title, url, priceRaw, locationRaw });
  });
  return cards;
}

/** Stable listing id from either URL style Craigslist serves. */
export function clListingIdFromUrl(url: string): string | null {
  const classic = url.match(/\/(\d{9,})\.html/);
  if (classic) return classic[1];
  const opaque = url.match(/\/view\/d\/[^/]+\/([A-Za-z0-9_-]{8,})\/?$/);
  if (opaque) return opaque[1];
  return null;
}

interface ClDetail {
  title: string | null;
  priceRaw: string | null;
  description: string | null;
  rawDescription: string | null;
  bedroomsRaw: string | null;
  bathroomsRaw: string | null;
  squareFeetRaw: string | null;
  availabilityRaw: string | null;
  addressRaw: string | null;
  unitNumberPublic: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  mapAccuracy: number | null;
  postedAt: string | null;
  updatedAtRaw: string | null;
  numericPostId: string | null;
  photos: string[];
  attributes: Record<string, string>;
  plainAttrs: string[];
  listingStatus: ListingStatus;
}

const REMOVED_PATTERNS: Array<[RegExp, ListingStatus]> = [
  [/this posting has been deleted by its author/i, "removed_by_source"],
  [/this posting has been flagged for removal/i, "removed_by_source"],
  [/this posting has expired/i, "expired"],
];

export function parseClDetailPage(html: string): ClDetail {
  const $ = cheerio.load(html);
  const detail: ClDetail = {
    title: null,
    priceRaw: null,
    description: null,
    rawDescription: null,
    bedroomsRaw: null,
    bathroomsRaw: null,
    squareFeetRaw: null,
    availabilityRaw: null,
    addressRaw: null,
    unitNumberPublic: null,
    city: null,
    state: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    mapAccuracy: null,
    postedAt: null,
    updatedAtRaw: null,
    numericPostId: null,
    photos: [],
    attributes: {},
    plainAttrs: [],
    listingStatus: "active",
  };

  const bodyText = $("body").text();
  for (const [pattern, status] of REMOVED_PATTERNS) {
    if (pattern.test(bodyText)) {
      detail.listingStatus = status;
      return detail;
    }
  }

  detail.title = $("#titletextonly").first().text().trim() || null;
  detail.priceRaw = $(".price").first().text().trim() || null;

  // Attribute groups: plain spans ("0BR / 1Ba", "650ft2", "available now")
  // and labeled divs whose class carries the semantic key (pets_cat, laundry…).
  $(".attrgroup").each((_, group) => {
    $(group)
      .find("span.attr")
      .each((_, el) => {
        const span = $(el);
        if (span.parents("div.attr").length > 0) return;
        const text = span.text().replace(/\s+/g, " ").trim();
        if (text) detail.plainAttrs.push(text);
      });
    $(group)
      .find("div.attr")
      .each((_, el) => {
        const div = $(el);
        const key =
          (div.attr("class") ?? "")
            .split(/\s+/)
            .filter((c) => c && c !== "attr" && c !== "important")[0] ?? "misc";
        const value = div.find(".valu").text().replace(/\s+/g, " ").trim();
        if (value) detail.attributes[key] = value;
      });
  });

  const housing = $(".housing").first().text().trim();
  if (housing) detail.plainAttrs.push(housing);

  for (const attr of detail.plainAttrs) {
    if (/\d\s*br/i.test(attr) || /\bstudio\b/i.test(attr)) {
      detail.bedroomsRaw ??= attr;
    }
    if (/\d\s*ba/i.test(attr)) detail.bathroomsRaw ??= attr;
    if (/\d\s*(ft2|ft²|sqft)/i.test(attr)) detail.squareFeetRaw ??= attr;
    const avail = attr.match(/^available\s+(.+)$/i);
    if (avail) detail.availabilityRaw ??= avail[1].trim();
    if (/^available now$/i.test(attr)) detail.availabilityRaw ??= "now";
  }

  // Description: #postingbody minus the QR-code print block.
  const postingBody = $("#postingbody");
  if (postingBody.length) {
    postingBody.find(".print-information, .print-qrcode-container").remove();
    detail.rawDescription = postingBody.html();
    detail.description =
      htmlToText(postingBody.html())
        ?.replace(/^QR Code Link to This Post\s*/i, "")
        .trim() || null;
  }

  const map = $("#map");
  if (map.length) {
    const lat = Number(map.attr("data-latitude"));
    const lng = Number(map.attr("data-longitude"));
    // Posters sometimes drop the pin far from SF; a pin outside a generous
    // SF bounding box contradicts the claimed location, so treat it as
    // unknown (the raw values stay in rawPayload) rather than mapping it.
    const inSf = lat > 37.6 && lat < 37.85 && lng > -122.56 && lng < -122.3;
    if (Number.isFinite(lat) && Number.isFinite(lng) && inSf) {
      detail.latitude = lat;
      detail.longitude = lng;
    }
    const accuracy = Number(map.attr("data-accuracy"));
    detail.mapAccuracy = Number.isFinite(accuracy) ? accuracy : null;
  }

  const mapAddress = $(".mapaddress").first().text().replace(/\s+/g, " ").trim();
  // When a poster hasn't disclosed a precise address, Craigslist renders the
  // ".mapaddress" element as a bare "(google map)" link instead of omitting
  // it — that link label is not an address and must never be stored as one.
  if (mapAddress && !/^\(?google\s*maps?\)?$/i.test(mapAddress)) {
    const unitMatch = mapAddress.match(/^(.*?)\s*[-–—]\s*(#?\w{1,8})$/);
    if (unitMatch && /\d/.test(unitMatch[2])) {
      detail.addressRaw = unitMatch[1].trim();
      detail.unitNumberPublic = unitMatch[2].replace(/^#/, "");
    } else {
      detail.addressRaw = mapAddress;
    }
  }
  const gmapHref = $('.mapaddress a[href*="maps.google"]').attr("href") ?? "";
  const gmapQ = decodeURIComponent(gmapHref).match(
    /loc:\s*(.+?)\s+san francisco\s+ca\s+(\d{5})/i,
  );
  if (gmapQ) {
    detail.city = "San Francisco";
    detail.state = "CA";
    detail.postalCode = gmapQ[2];
  }

  $(".postinginfo").each((_, el) => {
    const text = $(el).text().trim();
    const idMatch = text.match(/post id:\s*(\d+)/i);
    if (idMatch) detail.numericPostId = idMatch[1];
  });
  $(".postinginfo time[datetime]").each((_, el) => {
    const label = $(el).parent().text().toLowerCase();
    const datetime = $(el).attr("datetime") ?? null;
    if (!datetime) return;
    if (label.includes("updated")) detail.updatedAtRaw = datetime;
    else if (label.includes("posted") && !detail.postedAt) {
      detail.postedAt = new Date(datetime).toISOString();
    }
  });

  const imgListMatch = html.match(/var imgList = (\[.*?\]);/s);
  if (imgListMatch) {
    try {
      const imgs = JSON.parse(imgListMatch[1]) as Array<{ url?: string }>;
      detail.photos = imgs
        .map((img) => img.url)
        .filter((u): u is string => typeof u === "string");
    } catch {
      // fall through to thumbs
    }
  }
  if (detail.photos.length === 0) {
    $("#thumbs a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href) detail.photos.push(href);
    });
  }

  return detail;
}

/** "now" -> the fetch date; "jul 15" -> next occurrence of that date. */
export function parseClAvailability(
  raw: string | null,
  now: Date,
): string | null {
  if (!raw) return null;
  if (/^now$/i.test(raw)) return now.toISOString().slice(0, 10);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = raw.toLowerCase().match(/([a-z]{3})[a-z]*\s+(\d{1,2})/);
  if (!m || !(m[1] in months)) return null;
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), months[m[1]], Number(m[2])),
  );
  // Dates that already passed this year mean next year.
  if (candidate.getTime() < now.getTime() - 45 * 24 * 3600 * 1000) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
  }
  return candidate.toISOString().slice(0, 10);
}

function buildListing(
  card: ClSearchCard,
  sourceListingId: string,
  detail: ClDetail | null,
  now: Date,
): NormalizedListing {
  const hood = matchNeighborhood(card.locationRaw);
  const base: NormalizedListing = {
    sourceListingId,
    originalUrl: card.url,
    title: card.title,
    fetchDepth: detail ? "detail" : "card",
    priceRaw: card.priceRaw,
    priceMonthly: parsePrice(card.priceRaw),
    sourceNeighborhoodRaw: card.locationRaw,
    neighborhood: hood?.name ?? null,
    // PM titles often carry the unit ("1520 Gough St - 304") even when the
    // structured address omits it.
    unitNumberPublic: extractUnitFromTitle(card.title),
    city: "San Francisco",
    state: "CA",
    listingType: "rent",
    rawPayload: { card },
  };
  if (!detail) return base;

  const attrText = [
    ...detail.plainAttrs,
    ...Object.entries(detail.attributes).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  const petsText = [
    detail.attributes.pets_cat ?? "",
    detail.attributes.pets_dog ?? "",
    attrText,
  ].join("\n");
  const pets = parsePetPolicy(petsText);
  const laundryRaw =
    detail.attributes.laundry ??
    detail.plainAttrs.find((a) => normalizeLaundry(a)) ??
    null;
  const parkingRaw =
    detail.attributes.parking ??
    detail.plainAttrs.find((a) => normalizeParking(a)) ??
    null;
  const description = detail.description;
  const concessionsRaw = extractConcessions(description);
  const priceMonthly = parsePrice(detail.priceRaw ?? card.priceRaw);
  const amenitiesRaw = [
    ...detail.plainAttrs.filter(
      (a) =>
        !/\d\s*(br|ba|ft2|ft²|sqft)/i.test(a) && !/^available/i.test(a),
    ),
    ...Object.entries(detail.attributes)
      .filter(([k]) => !["pets_cat", "pets_dog", "rent_period", "laundry", "parking", "housing_type"].includes(k))
      .map(([, v]) => v),
  ];

  const geocodePrecision =
    detail.latitude == null
      ? null
      : detail.addressRaw && /\d/.test(detail.addressRaw)
        ? detail.mapAccuracy != null && detail.mapAccuracy <= 10
          ? "exact_address"
          : "building"
        : "block";

  return {
    ...base,
    fetchDepth: "detail",
    title: detail.title ?? card.title,
    priceRaw: detail.priceRaw ?? card.priceRaw,
    priceMonthly,
    priceEffectiveMonthly: computeEffectiveMonthly(priceMonthly, concessionsRaw),
    concessionsRaw,
    description,
    rawDescription: detail.rawDescription,
    bedroomsRaw: detail.bedroomsRaw,
    bedrooms: parseBedrooms(detail.bedroomsRaw),
    bathroomsRaw: detail.bathroomsRaw,
    bathrooms: parseBathrooms(detail.bathroomsRaw),
    squareFeetRaw: detail.squareFeetRaw,
    squareFeet: parseSquareFeet(detail.squareFeetRaw),
    addressRaw: detail.addressRaw,
    unitNumberPublic: detail.unitNumberPublic ?? base.unitNumberPublic,
    postalCode: detail.postalCode,
    latitude: detail.latitude,
    longitude: detail.longitude,
    geocodePrecision,
    availableDate: parseClAvailability(detail.availabilityRaw, now),
    postedDateRaw: detail.postedAt,
    postedAt: detail.postedAt,
    propertyType: detail.attributes.housing_type ?? null,
    leaseTermRaw: detail.attributes.rent_period ?? null,
    photos: detail.photos,
    primaryPhotoUrl: detail.photos[0] ?? null,
    amenitiesRaw,
    laundryRaw,
    laundryNormalized: normalizeLaundry(laundryRaw ?? attrText),
    parkingRaw,
    parkingNormalized: normalizeParking(parkingRaw ?? attrText),
    petPolicyRaw:
      [detail.attributes.pets_cat, detail.attributes.pets_dog]
        .filter(Boolean)
        .join("; ") || null,
    catsAllowed: pets.catsAllowed,
    dogsAllowed: pets.dogsAllowed,
    dogRestrictionsRaw: pets.dogRestrictionsRaw,
    listingStatus: detail.listingStatus,
    rawPayload: {
      card,
      attributes: detail.attributes,
      plainAttrs: detail.plainAttrs,
      availabilityRaw: detail.availabilityRaw,
      numericPostId: detail.numericPostId,
      updatedAtRaw: detail.updatedAtRaw,
      mapAccuracy: detail.mapAccuracy,
    },
  };
}

export const craigslistAdapter: SourceAdapter = {
  adapterType: "craigslist",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const now = new Date();
    const searchUrl = ctx.source.listingUrl;
    if (!searchUrl) {
      result.fatalError = "source has no listingUrl configured";
      return result;
    }

    const page = await ctx.fetcher.fetchText(searchUrl);
    result.pagesVisited = 1;
    if (!page.ok) {
      result.fatalError = `search page fetch failed: ${page.error}`;
      result.pageTrace.push({
        page: 1,
        url: searchUrl,
        httpStatus: page.status,
        listingsExtracted: 0,
        note: page.error ?? undefined,
      });
      return result;
    }
    result.htmlHash = sha256Hex(page.text);
    ctx.saveDebug("search-page-1.html", page.text);

    const allCards = parseClSearchPage(page.text);
    const sfCards = allCards.filter((c) => isSfLocation(c.locationRaw));
    result.pageTrace.push({
      page: 1,
      url: searchUrl,
      httpStatus: page.status,
      listingsExtracted: sfCards.length,
      note: `${allCards.length} total on page; ${allCards.length - sfCards.length} filtered as outside SF`,
    });

    if (allCards.length === 0) {
      result.fatalError =
        "zero results parsed from search page — source structure may have changed";
      result.paginationCompleted = false;
      return result;
    }

    // The static fallback serves a single page and ignores offset params.
    // Below ~350 results we've plausibly seen everything it exposes; at the
    // cap we cannot know what was cut off, so completion becomes unknown.
    if (allCards.length < 350) {
      result.paginationCompleted = true;
    } else {
      result.paginationCompleted = null;
      result.warnings.push(
        `static search page returned ${allCards.length} results, near its ~360 cap; older listings may exist beyond it (Craigslist's JS-only pagination is deliberately not used)`,
      );
    }
    result.totalListingsReportedBySource = null;

    // Decide which listings need a detail fetch: unknown ones, and known ones
    // whose card price changed. Everything else is refreshed at card depth.
    interface Planned {
      card: ClSearchCard;
      id: string;
      needsDetail: boolean;
    }
    const planned: Planned[] = [];
    for (const card of sfCards) {
      const id = clListingIdFromUrl(card.url);
      if (!id) {
        result.warnings.push(`could not extract listing id from ${card.url}`);
        continue;
      }
      const known = ctx.knownListings.get(id);
      const cardPrice = parsePrice(card.priceRaw);
      const needsDetail =
        !known ||
        !known.detailFetchedAt ||
        (cardPrice != null && known.priceMonthly !== cardPrice);
      planned.push({ card, id, needsDetail });
    }

    const needingDetail = planned.filter((p) => p.needsDetail);
    const detailBudget = ctx.source.maxDetailPagesPerRun;
    const toFetch = needingDetail.slice(0, detailBudget);
    if (needingDetail.length > toFetch.length) {
      result.warnings.push(
        `detail budget exhausted: ${needingDetail.length} listings need detail pages, cap is ${detailBudget}; the rest saved at card depth this run`,
      );
    }
    ctx.log(
      `craigslist: ${sfCards.length} SF cards (${allCards.length} raw), ${needingDetail.length} need detail, fetching ${toFetch.length}`,
    );

    const detailById = new Map<string, ClDetail>();
    for (const p of toFetch) {
      const res = await ctx.fetcher.fetchText(p.card.url);
      result.detailPagesVisited++;
      if (!res.ok) {
        result.detailFetchFailures++;
        result.warnings.push(
          `detail fetch failed for ${p.card.url}: ${res.error}`,
        );
        continue;
      }
      const detail = parseClDetailPage(res.text);
      if (!detail.title && detail.listingStatus === "active") {
        result.detailFetchFailures++;
        result.warnings.push(
          `detail parse produced no title for ${p.card.url} — structure may have changed`,
        );
        ctx.saveDebug(`detail-unparsed-${p.id}.html`, res.text);
        continue;
      }
      detailById.set(p.id, detail);
    }

    result.detailExtractionCompleted =
      result.detailFetchFailures === 0 &&
      needingDetail.length === toFetch.length;

    for (const p of planned) {
      const detail = detailById.get(p.id) ?? null;
      if (detail && detail.listingStatus !== "active") {
        // Card listed it but the posting is already gone — record the status.
        result.listings.push({
          ...buildListing(p.card, p.id, null, now),
          listingStatus: detail.listingStatus,
        });
        continue;
      }
      result.listings.push(buildListing(p.card, p.id, detail, now));
    }

    return result;
  },
};
