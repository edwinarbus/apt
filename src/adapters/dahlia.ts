import { sha256Hex } from "@/core/hash";
import { parseBathrooms, parseSquareFeet } from "@/core/normalize";
import type { NormalizedListing } from "@/core/types";
import type { AdapterContext, AdapterRunResult, SourceAdapter } from "./types";
import { emptyRunResult } from "./types";

/**
 * DAHLIA — the City & County of San Francisco's official affordable-housing
 * portal (housing.sfgov.org). A public, plain-HTTP JSON API backs the whole
 * site.
 *
 * Data path (verified 2026-07-03, plain HTTP, no browser):
 *   GET /api/v1/listings?type=rental → every open rental listing in ONE
 *   response: building name + street address + zip, per-bedroom-type unit
 *   summaries (min/max rent, sqft, availability), a building photo, and the
 *   income limits. One listing per (building, unit type), mirroring how the
 *   other adapters split a building into rentable units.
 *
 * These are below-market-rate / income-restricted homes (BMR + tax-credit
 * lottery units), so the description flags the income limits and the fact that
 * most are allocated by lottery — the original DAHLIA page is the source of
 * truth for eligibility and how to apply.
 */

const LISTINGS_PATH = "/api/v1/listings?type=rental";

interface DahliaUnit {
  unitType?: string;
  minMonthlyRent?: number | null;
  maxMonthlyRent?: number | null;
  minSquareFt?: number | null;
  maxSquareFt?: number | null;
  availability?: number | null;
  absoluteMaxIncome?: number | null;
}
interface DahliaImage {
  Image_URL?: string;
}
interface DahliaListing {
  listingID?: string;
  Name?: string;
  Building_Name?: string | null;
  Building_Street_Address?: string | null;
  Building_City?: string | null;
  Building_State?: string | null;
  Building_Zip_Code?: string | null;
  Status?: string | null;
  Tenure?: string | null;
  Application_Due_Date?: string | null;
  imageURL?: string | null;
  Listing_Images?: DahliaImage[] | null;
  unitSummaries?: { general?: DahliaUnit[] | null; reserved?: DahliaUnit[] | null } | null;
}

/** "Studio"/"SRO" → 0, "1 BR" → 1, "2 BR" → 2, … */
function bedroomsFromUnitType(unitType: string): number | null {
  const t = unitType.trim().toLowerCase();
  if (/studio|sro/.test(t)) return 0;
  const m = t.match(/(\d+)\s*br/);
  return m ? Number(m[1]) : null;
}

function photosFor(l: DahliaListing): string[] {
  // Prefer the pre-sized listing image (~768px). The `Listing_Images` are
  // full-resolution originals — some exceed Claude's 8000px vision limit — so
  // they're only a fallback when no sized image exists.
  const push = (u: unknown, out: string[]) => {
    if (typeof u === "string" && /^https?:\/\//.test(u.trim()) && !out.includes(u.trim())) {
      out.push(u.trim());
    }
  };
  const sized: string[] = [];
  push(l.imageURL, sized);
  if (sized.length > 0) return sized;
  const originals: string[] = [];
  for (const img of l.Listing_Images ?? []) push(img?.Image_URL, originals);
  return originals.slice(0, 1);
}

export function buildListingsFromDahlia(l: DahliaListing): NormalizedListing[] {
  const listingID = l.listingID?.trim();
  if (!listingID) return [];
  if (!/^san francisco$/i.test((l.Building_City ?? "").trim())) return [];

  const originalUrl = `https://housing.sfgov.org/listings/${listingID}`;
  const address = l.Building_Street_Address?.trim() || null;
  const propertyName = (l.Building_Name || l.Name)?.trim() || null;
  const photos = photosFor(l);
  const units = [
    ...(l.unitSummaries?.general ?? []),
    ...(l.unitSummaries?.reserved ?? []),
  ].filter((u) => u && u.unitType);

  const dueDate = l.Application_Due_Date?.slice(0, 10) ?? null;
  const out: NormalizedListing[] = [];
  const seenUnitKeys = new Set<string>();

  for (const u of units) {
    const unitType = (u.unitType ?? "").trim();
    if (!unitType || seenUnitKeys.has(unitType)) continue;
    seenUnitKeys.add(unitType);
    const unitSlug = unitType.replace(/\s+/g, "").toLowerCase();

    const rent = u.minMonthlyRent ?? u.maxMonthlyRent ?? null;
    const sqft = u.minSquareFt ?? u.maxSquareFt ?? null;
    const maxIncome = u.absoluteMaxIncome ?? null;

    const income = maxIncome
      ? ` Income-restricted: household max income about $${maxIncome.toLocaleString()}/yr for this unit type.`
      : "";
    const description =
      `Below-market-rate (affordable) ${unitType} at ${propertyName ?? address ?? "an SF building"}, ` +
      `listed on the City of San Francisco's DAHLIA housing portal. Most DAHLIA homes are allocated by ` +
      `lottery — apply and confirm eligibility on the original listing.` +
      income +
      (dueDate ? ` Application due ${dueDate}.` : "");

    out.push({
      sourceListingId: `${listingID}-${unitSlug}`,
      // The DAHLIA page is per building; a unit-type query param keeps each
      // unit-type listing's URL unique (fragments are stripped in dedupe) while
      // still opening the right page (the site ignores the extra param).
      originalUrl: `${originalUrl}?unit=${unitSlug}`,
      title: [propertyName ?? address, unitType].filter(Boolean).join(" — ") || `DAHLIA ${listingID}`,
      fetchDepth: "detail",
      description,
      propertyName,
      unitNumberPublic: unitType,
      addressRaw: address,
      city: "San Francisco",
      state: l.Building_State?.trim() || "CA",
      postalCode: l.Building_Zip_Code?.trim() || null,
      // No coordinates in the feed → let the geocoder resolve address → coords.
      latitude: null,
      longitude: null,
      geocodePrecision: null,
      priceRaw: rent != null ? `$${rent}/mo (BMR)` : null,
      priceMonthly: rent != null ? Math.round(rent) : null,
      bedroomsRaw: unitType,
      bedrooms: bedroomsFromUnitType(unitType),
      bathroomsRaw: null,
      bathrooms: parseBathrooms(""),
      squareFeetRaw: sqft != null ? `${sqft} sqft` : null,
      squareFeet: sqft != null ? parseSquareFeet(`${sqft} sqft`) : null,
      propertyType: "apartment",
      listingType: "rent",
      availableDate: dueDate,
      photos,
      primaryPhotoUrl: photos[0] ?? null,
      applicationUrl: originalUrl,
      contactUrl: originalUrl,
      listingStatus: "active",
      rawPayload: { dahlia: { listingID, Status: l.Status, unitType } },
    });
  }
  return out;
}

export const dahliaAdapter: SourceAdapter = {
  adapterType: "dahlia",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const baseUrl = ctx.source.baseUrl ?? "https://housing.sfgov.org";
    const url = `${baseUrl}${LISTINGS_PATH}`;

    const res = await ctx.fetcher.fetchText(url, { headers: { Accept: "application/json" } });
    result.pagesVisited = 1;
    if (!res.ok) {
      result.fatalError = `DAHLIA listings fetch failed: ${res.error}`;
      return result;
    }

    let listings: DahliaListing[];
    try {
      const parsed = JSON.parse(res.text) as { listings?: DahliaListing[] };
      listings = parsed.listings ?? [];
    } catch (err) {
      result.fatalError = `could not parse DAHLIA response: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    result.totalListingsReportedBySource = listings.length;
    if (listings.length === 0) {
      result.fatalError = "DAHLIA returned zero rental listings — structure may have changed";
      result.paginationCompleted = false;
      return result;
    }

    const bySourceId = new Map<string, NormalizedListing>();
    for (const l of listings) {
      for (const listing of buildListingsFromDahlia(l)) {
        if (!bySourceId.has(listing.sourceListingId)) bySourceId.set(listing.sourceListingId, listing);
      }
    }

    result.listings = [...bySourceId.values()];
    result.htmlHash = sha256Hex(res.text);
    // One complete JSON response, no pagination, no detail pages.
    result.paginationCompleted = true;
    result.detailExtractionCompleted = true;
    result.pageTrace.push({
      page: 1,
      url,
      httpStatus: res.status,
      listingsExtracted: result.listings.length,
      note: `${listings.length} SF rental listings → ${result.listings.length} unit-type listings`,
    });
    ctx.log(`dahlia: ${listings.length} listings → ${result.listings.length} unit-type listings`);

    if (result.listings.length === 0) {
      result.fatalError = "zero SF unit-type listings extracted from DAHLIA";
      result.paginationCompleted = false;
    }
    return result;
  },
};
