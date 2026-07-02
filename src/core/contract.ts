import type { AdapterRunResult } from "@/adapters/types";
import { canonicalizeListingUrl } from "./urls";

/**
 * The shared adapter contract: structural guarantees every adapter result
 * must satisfy before its listings are trusted. Violations are `error`
 * (the run cannot be considered a PASS) or `warning` (quality problems worth
 * surfacing but not disqualifying). The same validation runs inside the
 * ingestion runner (issues become run warnings) and the verification command.
 */

export interface ContractIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ContractStats {
  total: number;
  withOriginalUrl: number;
  withTitle: number;
  withPrice: number;
  withPriceRawButUnparsed: number;
  withLocation: number; // neighborhood, coordinates, or address
  withCoordinates: number;
  withPhotos: number;
  withDescription: number;
  detailDepth: number;
  cardDepth: number;
  duplicateOriginalUrls: number;
  duplicateSourceListingIds: number;
}

export interface ContractReport {
  issues: ContractIssue[];
  stats: ContractStats;
  ok: boolean; // no errors
}

export function validateAdapterResult(result: AdapterRunResult): ContractReport {
  const issues: ContractIssue[] = [];
  const listings = result.listings;
  const stats: ContractStats = {
    total: listings.length,
    withOriginalUrl: 0,
    withTitle: 0,
    withPrice: 0,
    withPriceRawButUnparsed: 0,
    withLocation: 0,
    withCoordinates: 0,
    withPhotos: 0,
    withDescription: 0,
    detailDepth: 0,
    cardDepth: 0,
    duplicateOriginalUrls: 0,
    duplicateSourceListingIds: 0,
  };

  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, number>();

  for (const l of listings) {
    if (l.originalUrl && /^https?:\/\//.test(l.originalUrl)) {
      stats.withOriginalUrl++;
      const canonical = canonicalizeListingUrl(l.originalUrl) ?? l.originalUrl;
      seenUrls.set(canonical, (seenUrls.get(canonical) ?? 0) + 1);
    }
    if (l.title && l.title.trim().length > 0) stats.withTitle++;
    if (l.priceMonthly != null) stats.withPrice++;
    else if (l.priceRaw) stats.withPriceRawButUnparsed++;
    if (l.neighborhood || l.addressRaw || (l.latitude != null && l.longitude != null)) {
      stats.withLocation++;
    }
    if (l.latitude != null && l.longitude != null) stats.withCoordinates++;
    if ((l.photos?.length ?? 0) > 0) stats.withPhotos++;
    if (l.description || l.rawDescription) stats.withDescription++;
    if (l.fetchDepth === "detail") stats.detailDepth++;
    else stats.cardDepth++;
    if (l.sourceListingId) {
      seenIds.set(l.sourceListingId, (seenIds.get(l.sourceListingId) ?? 0) + 1);
    }
  }

  const missingUrl = stats.total - stats.withOriginalUrl;
  if (missingUrl > 0) {
    issues.push({
      level: "error",
      code: "missing_original_url",
      message: `${missingUrl}/${stats.total} listings lack a valid original URL`,
    });
  }
  const missingTitle = stats.total - stats.withTitle;
  if (missingTitle > 0) {
    issues.push({
      level: "error",
      code: "missing_title",
      message: `${missingTitle}/${stats.total} listings lack a title`,
    });
  }
  const missingId = listings.filter((l) => !l.sourceListingId).length;
  if (missingId > 0) {
    issues.push({
      level: "error",
      code: "missing_source_listing_id",
      message: `${missingId}/${stats.total} listings lack a stable source listing id`,
    });
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      stats.duplicateSourceListingIds += count - 1;
      issues.push({
        level: "error",
        code: "duplicate_source_listing_id",
        message: `sourceListingId "${id}" appears ${count} times in one run`,
      });
    }
  }
  for (const [url, count] of seenUrls) {
    if (count > 1) {
      stats.duplicateOriginalUrls += count - 1;
      issues.push({
        level: "error",
        code: "duplicate_original_url",
        message: `original URL appears ${count} times in one run: ${url}`,
      });
    }
  }

  if (stats.total > 0) {
    const priceCoverage = stats.withPrice / stats.total;
    if (priceCoverage < 0.6) {
      issues.push({
        level: "warning",
        code: "low_price_coverage",
        message: `only ${stats.withPrice}/${stats.total} listings have a parsed price`,
      });
    }
    if (stats.withPriceRawButUnparsed > stats.total * 0.1) {
      issues.push({
        level: "warning",
        code: "price_parse_failures",
        message: `${stats.withPriceRawButUnparsed} listings have raw price text that failed to parse`,
      });
    }
    const locationCoverage = stats.withLocation / stats.total;
    if (locationCoverage < 0.6) {
      issues.push({
        level: "warning",
        code: "low_location_coverage",
        message: `only ${stats.withLocation}/${stats.total} listings have any location information`,
      });
    }
    if (stats.detailDepth >= 10 && stats.withPhotos / stats.detailDepth < 0.3) {
      issues.push({
        level: "warning",
        code: "low_photo_coverage",
        message: `only ${stats.withPhotos}/${stats.detailDepth} detail-fetched listings have photos`,
      });
    }
  }

  return {
    issues,
    stats,
    ok: !issues.some((i) => i.level === "error"),
  };
}
