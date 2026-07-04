import type { SourceRow } from "@/db/schema";
import type { TextFetcher } from "@/core/fetcher";
import type { NormalizedListing, PageTraceEntry } from "@/core/types";

/**
 * A previously stored listing, summarized so adapters can skip re-fetching
 * detail pages for listings that have not visibly changed. This is the main
 * politeness lever: steady-state runs only open detail pages for new or
 * changed listings.
 */
export interface KnownListing {
  sourceListingId: string;
  title: string;
  priceMonthly: number | null;
  contentHash: string;
  detailFetchedAt: string | null;
  /**
   * Enough of the stored row to re-fetch a listing's detail page directly by
   * URL, even when it has scrolled off the source's current results page.
   * Adapters (e.g. Craigslist) use this to drain a backlog of active listings
   * that were only ever saved at card depth — otherwise a listing that ages
   * off page one before its detail budget came up would stay info-less
   * forever. Optional so adapters that don't need it can ignore it.
   */
  originalUrl?: string;
  priceRaw?: string | null;
  sourceNeighborhoodRaw?: string | null;
  staleStatus?: string;
}

export interface AdapterContext {
  source: SourceRow;
  fetcher: TextFetcher;
  knownListings: Map<string, KnownListing>;
  log: (message: string) => void;
  /** Persist raw HTML/JSON for post-mortem parser debugging. Returns the path, or null if disabled. */
  saveDebug: (name: string, content: string) => string | null;
}

export interface AdapterRunResult {
  listings: NormalizedListing[];
  pageTrace: PageTraceEntry[];
  pagesVisited: number;
  detailPagesVisited: number;
  /** listings needing a detail fetch that failed with an error (not budget-skips) */
  detailFetchFailures: number;
  totalListingsReportedBySource: number | null;
  /**
   * true  — we are confident every result page was visited
   * false — pagination stopped early (cap hit, error, structure change)
   * null  — cannot be determined for this source
   */
  paginationCompleted: boolean | null;
  detailExtractionCompleted: boolean | null;
  warnings: string[];
  /** set when the run cannot produce trustworthy results at all */
  fatalError: string | null;
  /** hash of the first results page, to detect source structure changes across runs */
  htmlHash: string | null;
}

export interface SourceAdapter {
  adapterType: string;
  run(ctx: AdapterContext): Promise<AdapterRunResult>;
}

export function emptyRunResult(): AdapterRunResult {
  return {
    listings: [],
    pageTrace: [],
    pagesVisited: 0,
    detailPagesVisited: 0,
    detailFetchFailures: 0,
    totalListingsReportedBySource: null,
    paginationCompleted: null,
    detailExtractionCompleted: null,
    warnings: [],
    fatalError: null,
    htmlHash: null,
  };
}
