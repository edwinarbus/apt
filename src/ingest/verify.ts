import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nowIso } from "@/db/client";
import { listings, sources, type SourceRow } from "@/db/schema";
import { getAdapter } from "@/adapters/registry";
import type { KnownListing } from "@/adapters/types";
import {
  PoliteFetcher,
  type FetchResult,
  type FetchTraceEntry,
  type TextFetcher,
} from "@/core/fetcher";
import { PlaywrightFetcher } from "@/core/playwright-fetcher";
import { checkRobots } from "@/core/robots";
import { validateAdapterResult, type ContractStats } from "@/core/contract";
import { shouldProcessStaleUpdates } from "@/core/stale";

/**
 * Adapter verification: runs an adapter (live or against recorded fixtures),
 * validates the result against the adapter contract, and produces a
 * PASS / PARTIAL / FAIL / SKIPPED report. Verification NEVER writes listings —
 * the only optional persistence is the verification outcome on the source row.
 */

export type VerificationStatus = "PASS" | "PARTIAL" | "FAIL" | "SKIPPED";

export interface VerificationReport {
  sourceId: string;
  sourceName: string;
  registryStatus: string;
  status: VerificationStatus;
  mode: "live" | "fixture" | "none";
  skippedReason?: string;
  listingsExtracted: number;
  pagesVisited: number;
  detailPagesVisited: number;
  paginationCompleted: boolean | null;
  detailExtractionCompleted: boolean | null;
  stats: ContractStats | null;
  /** positive facts worth reading ("142 listings have original URLs") */
  checks: string[];
  /** quality problems that make the run PARTIAL */
  warnings: string[];
  /** disqualifying problems that make the run FAIL */
  errors: string[];
  /** by-design caveats that do not affect status */
  notes: string[];
  staleSafety: string;
  durationMs: number;
}

// Live verification is a light probe, so it caps detail fetches. Fixtures are
// local and free, so fixture verification fetches everything (it needs the
// full set to judge pagination for sources whose "detail" pages ARE their
// listings, like Mosser's per-property fetches).
const LIVE_VERIFY_DETAIL_CAP = 8;
const FIXTURE_VERIFY_DETAIL_CAP = 500;

/**
 * Warnings that are disclosures of known, by-design behavior rather than
 * quality regressions. They are reported as notes and do not demote a PASS.
 */
const INFORMATIONAL_WARNING_PATTERNS = [
  /static search page returned \d+ results, near its ~360 cap/,
  /detail budget exhausted/, // verification imposes its own small cap
  /property budget exhausted/, // Mosser: verification's live cap, not a defect
];

/**
 * When pagination is incomplete ONLY because verification's own cap stopped it
 * short (a "budget exhausted" note is present), that's a deliberate sample —
 * not a source/adapter problem — so it should not demote the verdict.
 */
function paginationIncompleteIsJustSampling(notes: string[]): boolean {
  return notes.some((n) => /budget exhausted/.test(n));
}

/** Serve recorded fixtures to adapters so verification can run offline. */
export class FixtureFetcher implements TextFetcher {
  requestsMade = 0;
  trace: FetchTraceEntry[] = [];

  constructor(
    private routes: Array<{
      match: (url: string, method: string) => boolean;
      file: string;
    }>,
  ) {}

  async fetchText(
    url: string,
    init?: { method?: string },
  ): Promise<FetchResult> {
    this.requestsMade++;
    const method = init?.method ?? "GET";
    const route = this.routes.find((r) => r.match(url, method));
    const base = {
      url,
      finalUrl: url,
      elapsedMs: 0,
    };
    if (!route) {
      this.trace.push({ url, method, status: 404, elapsedMs: 0, bytes: 0, error: "no fixture route", at: nowIso() });
      return { ...base, status: 404, ok: false, text: "", error: "no fixture route for url" };
    }
    try {
      const text = fs.readFileSync(
        path.join(process.cwd(), "fixtures", route.file),
        "utf8",
      );
      this.trace.push({ url, method, status: 200, elapsedMs: 0, bytes: text.length, error: null, at: nowIso() });
      return { ...base, status: 200, ok: true, text, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.trace.push({ url, method, status: null, elapsedMs: 0, bytes: 0, error: message, at: nowIso() });
      return { ...base, status: null, ok: false, text: "", error: message };
    }
  }
}

/** Which fixtures serve which URLs, per adapter type. */
export function fixtureRoutesFor(
  adapterType: string,
): Array<{ match: (url: string, method: string) => boolean; file: string }> | null {
  switch (adapterType) {
    case "craigslist":
      return [
        { match: (url) => url.includes("/search/"), file: "cl-search.html" },
        { match: () => true, file: "cl-detail.html" },
      ];
    case "rentsfnow":
      return [
        {
          match: (url, method) => method === "POST" && url.includes("admin-ajax"),
          file: "rsn-results-p1.html",
        },
        { match: () => true, file: "rsn-detail.html" },
      ];
    case "rentbt":
      return [{ match: () => true, file: "bt-api.json" }];
    case "mosser":
      return [
        {
          match: (url) => url.includes("/wp-json/wp/v2/city"),
          file: "mosser-city.json",
        },
        {
          match: (url) => url.includes("rentpress_property"),
          file: "mosser-sf-props.json",
        },
        { match: (url) => /415-pierce/.test(url), file: "mosser-property-multi.html" },
        { match: () => true, file: "mosser-property-single.html" },
      ];
    default:
      return null;
  }
}

export interface VerifyOptions {
  mode: "live" | "fixture";
  /** persist the outcome onto the source row (default true) */
  save?: boolean;
  /** verify a disabled source anyway (explicit --source runs) */
  force?: boolean;
  log?: (message: string) => void;
}

function skipped(
  source: Pick<SourceRow, "id" | "name" | "registryStatus">,
  reason: string,
): VerificationReport {
  return {
    sourceId: source.id,
    sourceName: source.name,
    registryStatus: source.registryStatus,
    status: "SKIPPED",
    mode: "none",
    skippedReason: reason,
    listingsExtracted: 0,
    pagesVisited: 0,
    detailPagesVisited: 0,
    paginationCompleted: null,
    detailExtractionCompleted: null,
    stats: null,
    checks: [],
    warnings: [],
    errors: [],
    notes: [],
    staleSafety: "n/a",
    durationMs: 0,
  };
}

export async function verifySource(
  db: Db,
  sourceId: string,
  opts: VerifyOptions,
): Promise<VerificationReport> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const source = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) throw new Error(`unknown source: ${sourceId}`);

  const adapter = getAdapter(source.adapterType);
  if (!source.enabled && !opts.force) {
    const reason =
      source.permissionStatus === "reference_only_do_not_fetch"
        ? "disabled/reference-only"
        : adapter
          ? `disabled (${source.registryStatus.replaceAll("_", " ")})`
          : `disabled, no adapter for type "${source.adapterType}" (${source.registryStatus.replaceAll("_", " ")})`;
    const report = skipped(source, reason);
    if (opts.save !== false) await persistVerification(db, source.id, report);
    return report;
  }
  if (!adapter) {
    const report = skipped(source, `no adapter implemented for type "${source.adapterType}"`);
    if (opts.save !== false) await persistVerification(db, source.id, report);
    return report;
  }

  // Build the fetcher for the requested mode.
  let fetcher: TextFetcher;
  const mode: "live" | "fixture" = opts.mode;
  if (opts.mode === "fixture") {
    const routes = fixtureRoutesFor(source.adapterType);
    if (routes === null) {
      const report = skipped(
        source,
        `no fixtures recorded for adapter type "${source.adapterType}" — run with --live`,
      );
      if (opts.save !== false) await persistVerification(db, source.id, report);
      return report;
    }
    fetcher = new FixtureFetcher(routes);
  } else {
    const fetcherOpts = {
      requestDelayMs: source.requestDelayMs,
      timeoutMs: source.timeoutMs,
      retryCount: source.retryCount,
    };
    fetcher = source.needsJavaScript
      ? new PlaywrightFetcher(fetcherOpts)
      : new PoliteFetcher(fetcherOpts);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const checks: string[] = [];

  // Live mode: check robots first (read-only unless saving).
  if (mode === "live" && source.listingUrl) {
    const listingPath = new URL(source.listingUrl).pathname || "/";
    const robots = await checkRobots(
      fetcher,
      source.baseUrl ?? source.listingUrl,
      [listingPath],
    );
    checks.push(`robots.txt: ${robots.status} (${robots.notes})`);
    if (robots.status === "disallowed") {
      errors.push("robots.txt disallows the listing path — the runner will skip this source");
    }
    if (opts.save !== false) {
      await db
        .update(sources)
        .set({
          robotsStatus: robots.status,
          robotsCheckedAt: nowIso(),
          robotsNotes: robots.notes,
          updatedAt: nowIso(),
        })
        .where(eq(sources.id, source.id))
        .run();
    }
  }

  // Known listings keep live verification polite (unchanged listings skip
  // detail fetches, exactly as a real run would).
  const knownRows =
    mode === "live"
      ? await db
          .select({
            sourceListingId: listings.sourceListingId,
            title: listings.title,
            priceMonthly: listings.priceMonthly,
            contentHash: listings.contentHash,
            detailFetchedAt: listings.detailFetchedAt,
          })
          .from(listings)
          .where(eq(listings.sourceId, source.id))
          .all()
      : [];
  const knownListings = new Map<string, KnownListing>(
    knownRows.map((r) => [r.sourceListingId, r]),
  );

  const detailCap =
    mode === "live"
      ? Math.min(source.maxDetailPagesPerRun, LIVE_VERIFY_DETAIL_CAP)
      : FIXTURE_VERIFY_DETAIL_CAP;
  const cappedSource: SourceRow = { ...source, maxDetailPagesPerRun: detailCap };
  notes.push(
    `verification caps detail fetches at ${detailCap} (config: ${source.maxDetailPagesPerRun})`,
  );

  let result;
  try {
    result = await adapter.run({
      source: cappedSource,
      fetcher,
      knownListings,
      log,
      saveDebug: () => null, // verification writes nothing
    });
  } catch (err) {
    errors.push(
      `adapter threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    result = null;
  } finally {
    await fetcher.close?.();
  }

  let stats: ContractStats | null = null;
  let status: VerificationStatus;
  let paginationCompleted: boolean | null = null;
  let detailExtractionCompleted: boolean | null = null;
  let pagesVisited = 0;
  let detailPagesVisited = 0;
  let listingsExtracted = 0;

  if (!result) {
    status = "FAIL";
  } else {
    pagesVisited = result.pagesVisited;
    detailPagesVisited = result.detailPagesVisited;
    paginationCompleted = result.paginationCompleted;
    detailExtractionCompleted = result.detailExtractionCompleted;
    listingsExtracted = result.listings.length;

    if (result.fatalError) errors.push(result.fatalError);
    if (result.listings.length === 0 && !result.fatalError) {
      errors.push("adapter extracted zero listings");
    }

    for (const warning of result.warnings) {
      if (INFORMATIONAL_WARNING_PATTERNS.some((p) => p.test(warning))) {
        notes.push(warning);
      } else {
        warnings.push(warning);
      }
    }

    const contract = validateAdapterResult(result);
    stats = contract.stats;
    for (const issue of contract.issues) {
      (issue.level === "error" ? errors : warnings).push(
        `[${issue.code}] ${issue.message}`,
      );
    }

    checks.push(`${stats.total} listings extracted`);
    checks.push(`${pagesVisited} page(s) visited, ${detailPagesVisited} detail page(s)`);
    checks.push(
      `pagination ${paginationCompleted === true ? "complete" : paginationCompleted === false ? "INCOMPLETE" : "completeness unknown (by design for this source)"}`,
    );
    checks.push(`${stats.withOriginalUrl}/${stats.total} listings have original URLs`);
    checks.push(`${stats.withPrice}/${stats.total} listings have parsed prices`);
    checks.push(
      `${stats.withLocation}/${stats.total} listings have neighborhoods, addresses, or coordinates`,
    );
    checks.push(`${stats.withPhotos}/${stats.total} listings have photos`);
    checks.push(
      `${stats.duplicateOriginalUrls} duplicate original URLs, ${stats.duplicateSourceListingIds} duplicate source ids within the run`,
    );
    if (result.detailFetchFailures > 0) {
      warnings.push(`${result.detailFetchFailures} detail page fetches failed`);
    }

    // Pagination that's incomplete only because verification capped the fetch
    // (a "budget exhausted" note) is a deliberate sample, not a defect.
    const paginationOkOrSampled =
      paginationCompleted !== false ||
      paginationIncompleteIsJustSampling(notes);
    if (paginationCompleted === false && paginationIncompleteIsJustSampling(notes)) {
      notes.push(
        "pagination shown as incomplete only because verification sampled a subset; a full run fetches the complete set",
      );
    }

    if (errors.length > 0) {
      status = "FAIL";
    } else if (!paginationOkOrSampled || warnings.length > 0) {
      status = "PARTIAL";
    } else {
      status = "PASS";
    }
  }

  const runStatusEquivalent =
    status === "PASS" ? "success" : status === "PARTIAL" ? "partial" : "failed";
  const staleWouldRun = shouldProcessStaleUpdates(
    runStatusEquivalent,
    paginationCompleted,
  );
  const staleSafety = staleWouldRun
    ? "missing-tracking WOULD run after a real ingest like this"
    : `missing-tracking would NOT run (${
        runStatusEquivalent !== "success"
          ? `run would be ${runStatusEquivalent}`
          : "pagination completeness unverified"
      }) — listings stay safe`;

  const report: VerificationReport = {
    sourceId: source.id,
    sourceName: source.name,
    registryStatus: source.registryStatus,
    status,
    mode,
    listingsExtracted,
    pagesVisited,
    detailPagesVisited,
    paginationCompleted,
    detailExtractionCompleted,
    stats,
    checks,
    warnings,
    errors,
    notes,
    staleSafety,
    durationMs: Date.now() - started,
  };
  if (opts.save !== false) await persistVerification(db, source.id, report);
  return report;
}

async function persistVerification(
  db: Db,
  sourceId: string,
  report: VerificationReport,
): Promise<void> {
  await db
    .update(sources)
    .set({
      lastVerificationStatus: report.status,
      lastVerificationAt: nowIso(),
      lastVerificationSummary: {
        mode: report.mode,
        listingsExtracted: report.listingsExtracted,
        errors: report.errors,
        warnings: report.warnings,
        skippedReason: report.skippedReason ?? null,
      },
      updatedAt: nowIso(),
    })
    .where(eq(sources.id, sourceId))
    .run();
}

export function formatVerificationReport(r: VerificationReport): string {
  const lines: string[] = [];
  lines.push(`${r.sourceId}: ${r.status}${r.mode !== "none" ? ` (${r.mode})` : ""}`);
  if (r.skippedReason) {
    lines.push(`  - ${r.skippedReason}`);
    return lines.join("\n");
  }
  for (const c of r.checks) lines.push(`  - ${c}`);
  for (const w of r.warnings) lines.push(`  - warning: ${w}`);
  for (const e of r.errors) lines.push(`  - ERROR: ${e}`);
  for (const n of r.notes) lines.push(`  - note: ${n}`);
  lines.push(`  - ${r.staleSafety}`);
  return lines.join("\n");
}
