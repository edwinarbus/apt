import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { newId, nowIso } from "@/db/client";
import {
  duplicateGroups,
  listingEvents,
  listings,
  sourceRuns,
  sources,
  type SourceRow,
} from "@/db/schema";
import { getAdapter } from "@/adapters/registry";
import type { KnownListing } from "@/adapters/types";
import { PoliteFetcher, type TextFetcher } from "@/core/fetcher";
import { PlaywrightFetcher } from "@/core/playwright-fetcher";
import { validateAdapterResult } from "@/core/contract";
import { parsePrice } from "@/core/normalize";
import { checkRobots } from "@/core/robots";
import { advanceStaleStatus, shouldProcessStaleUpdates } from "@/core/stale";
import { detectDuplicates, type DupeCandidate } from "@/core/dedupe";
import { neighborhoodForPoint } from "@/core/neighborhood-geo";
import { assessListing, computeBaselines } from "@/core/scam";
import {
  geocodeAddress,
  neighborhoodFallback,
  type GeocodeProvider,
} from "@/core/geocode";
import type { RunStatus } from "@/core/types";
import { upsertListing } from "./upsert";

/**
 * Ingestion runner: executes one source end to end and records an auditable
 * SourceRun. Order of operations matters —
 *   robots check -> adapter -> upserts -> run-status decision ->
 *   missing/stale processing (gated on a fully successful run) ->
 *   duplicate detection -> scam assessment -> geocoding -> run record.
 */

export interface RunOptions {
  /** run even if the source is disabled (explicit single-source runs) */
  force?: boolean;
  /** network geocoding (Nominatim) for listings without coordinates */
  geocode?: boolean;
  geocodeProvider?: GeocodeProvider;
  geocodeLimit?: number;
  log?: (message: string) => void;
  /** skip the live robots.txt check (tests) */
  skipRobotsCheck?: boolean;
  /** raise/lower the per-run detail-page cap (backfill uses a higher budget) */
  detailBudgetOverride?: number;
  /** false disables missing/stale updates entirely for this run (backfill safety flag) */
  staleUpdates?: boolean;
}

export interface RunSummary {
  sourceId: string;
  sourceName: string;
  status: RunStatus;
  skippedReason?: string;
  runId: string | null;
  listingsFound: number;
  newListings: number;
  changedListings: number;
  unchangedListings: number;
  priceChangedListings: number;
  priceHistoryEntries: number;
  missingListings: number;
  suspectedDuplicates: number;
  duplicateGroupsTouched: number;
  suspectedScams: number;
  pagesVisited: number;
  detailPagesVisited: number;
  paginationCompleted: boolean | null;
  detailExtractionCompleted: boolean | null;
  staleProcessed: boolean;
  geocoded: { network: number; cache: number; fallback: number };
  warnings: string[];
  errorMessage: string | null;
  durationMs: number;
}

const ROBOTS_RECHECK_MS = 7 * 24 * 3600 * 1000;

function skippedSummary(
  source: Pick<SourceRow, "id" | "name">,
  reason: string,
): RunSummary {
  return {
    sourceId: source.id,
    sourceName: source.name,
    status: "skipped",
    skippedReason: reason,
    runId: null,
    listingsFound: 0,
    newListings: 0,
    changedListings: 0,
    unchangedListings: 0,
    priceChangedListings: 0,
    priceHistoryEntries: 0,
    missingListings: 0,
    suspectedDuplicates: 0,
    duplicateGroupsTouched: 0,
    suspectedScams: 0,
    pagesVisited: 0,
    detailPagesVisited: 0,
    paginationCompleted: null,
    detailExtractionCompleted: null,
    staleProcessed: false,
    geocoded: { network: 0, cache: 0, fallback: 0 },
    warnings: [],
    errorMessage: null,
    durationMs: 0,
  };
}

export async function runSource(
  db: Db,
  sourceId: string,
  opts: RunOptions = {},
): Promise<RunSummary> {
  const log = opts.log ?? (() => {});
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) {
    throw new Error(`unknown source: ${sourceId} (run \`npm run seed:sources\` first)`);
  }
  if (!source.enabled && !opts.force) {
    return skippedSummary(source, "disabled/reference source");
  }
  const adapter = getAdapter(source.adapterType);
  if (!adapter) {
    return skippedSummary(
      source,
      `no adapter implemented for type "${source.adapterType}"`,
    );
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = newId("run");
  // JS-rendered sources get a browser-backed fetcher (rendering only the
  // pages that need it; robots.txt and server-rendered pages stay plain HTTP).
  const fetcherOpts = {
    requestDelayMs: source.requestDelayMs,
    timeoutMs: source.timeoutMs,
    retryCount: source.retryCount,
  };
  const fetcher: TextFetcher = source.needsJavaScript
    ? new PlaywrightFetcher(fetcherOpts)
    : new PoliteFetcher(fetcherOpts);

  // --- robots.txt (recorded on the source; disallowed sources are skipped) ---
  if (!opts.skipRobotsCheck && source.listingUrl) {
    const lastChecked = source.robotsCheckedAt
      ? Date.parse(source.robotsCheckedAt)
      : 0;
    if (
      source.robotsStatus === "not_checked" ||
      source.robotsStatus === "error" ||
      Date.now() - lastChecked > ROBOTS_RECHECK_MS
    ) {
      const listingPath = new URL(source.listingUrl).pathname || "/";
      const robots = await checkRobots(
        fetcher,
        source.baseUrl ?? source.listingUrl,
        [listingPath],
      );
      db.update(sources)
        .set({
          robotsStatus: robots.status,
          robotsCheckedAt: nowIso(),
          robotsNotes: robots.notes,
          updatedAt: nowIso(),
        })
        .where(eq(sources.id, source.id))
        .run();
      source.robotsStatus = robots.status;
      log(`${source.id}: robots.txt -> ${robots.status} (${robots.notes})`);
    }
  }
  if (source.robotsStatus === "disallowed") {
    const reason = "robots.txt disallows the listing path — source skipped";
    db.insert(sourceRuns)
      .values({
        id: runId,
        sourceId: source.id,
        startedAt,
        finishedAt: nowIso(),
        status: "skipped",
        errorMessage: reason,
        parserVersion: source.parserVersion,
        createdAt: nowIso(),
      })
      .run();
    await fetcher.close?.();
    return { ...skippedSummary(source, reason), runId };
  }

  // --- known listings give adapters their skip-detail-fetch signal ---
  const knownRows = db
    .select({
      sourceListingId: listings.sourceListingId,
      title: listings.title,
      priceMonthly: listings.priceMonthly,
      contentHash: listings.contentHash,
      detailFetchedAt: listings.detailFetchedAt,
    })
    .from(listings)
    .where(eq(listings.sourceId, source.id))
    .all();
  const knownListings = new Map<string, KnownListing>(
    knownRows.map((r) => [r.sourceListingId, r]),
  );

  const debugDir = path.join(process.cwd(), "data", "raw", source.id, runId);
  const saveDebug = (name: string, content: string): string | null => {
    try {
      fs.mkdirSync(debugDir, { recursive: true });
      const p = path.join(debugDir, name);
      fs.writeFileSync(p, content);
      return p;
    } catch {
      return null;
    }
  };

  // --- adapter ---
  const effectiveSource =
    opts.detailBudgetOverride != null
      ? { ...source, maxDetailPagesPerRun: opts.detailBudgetOverride }
      : source;
  let result;
  try {
    result = await adapter.run({
      source: effectiveSource,
      fetcher,
      knownListings,
      log,
      saveDebug,
    });
  } catch (err) {
    result = {
      listings: [],
      pageTrace: [],
      pagesVisited: 0,
      detailPagesVisited: 0,
      detailFetchFailures: 0,
      totalListingsReportedBySource: null,
      paginationCompleted: null,
      detailExtractionCompleted: null,
      warnings: [],
      fatalError: `adapter threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
      htmlHash: null,
    };
  }
  const warnings = [...result.warnings];

  // --- adapter contract validation (structural guarantees) ---
  const contract = validateAdapterResult(result);
  for (const issue of contract.issues) {
    warnings.push(`contract ${issue.level} [${issue.code}]: ${issue.message}`);
  }

  // --- decide run status BEFORE any stale processing ---
  let status: RunStatus;
  if (result.fatalError) {
    status = "failed";
  } else if (result.listings.length === 0) {
    status = "partial";
    warnings.push(
      "source returned zero listings — treated as partial; missing-listing processing skipped as a precaution",
    );
  } else if (result.paginationCompleted === false) {
    status = "partial";
  } else if (!contract.ok) {
    status = "partial";
    warnings.push(
      "adapter contract errors present — run treated as partial; missing-listing processing skipped",
    );
  } else if (
    result.detailPagesVisited >= 5 &&
    result.detailFetchFailures / result.detailPagesVisited > 0.3
  ) {
    status = "partial";
    warnings.push(
      `detail extraction failed for ${result.detailFetchFailures}/${result.detailPagesVisited} pages — treated as partial`,
    );
  } else {
    status = "success";
  }

  // --- upserts ---
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let priceChangedCount = 0;
  let priceHistoryCount = 0;
  const runListingIds: string[] = [];
  if (status !== "failed") {
    const now = nowIso();
    db.transaction((tx) => {
      for (const item of result.listings) {
        const outcome = upsertListing(tx as unknown as Db, source, item, runId, now);
        runListingIds.push(outcome.listingId);
        if (outcome.kind === "new") newCount++;
        else if (outcome.kind === "changed") changedCount++;
        else unchangedCount++;
        if (outcome.priceChanged) priceChangedCount++;
        if (outcome.priceHistoryRecorded) priceHistoryCount++;
      }
    });
  }

  // --- health checks against the previous successful run ---
  const prevRun = db
    .select()
    .from(sourceRuns)
    .where(and(eq(sourceRuns.sourceId, source.id), eq(sourceRuns.status, "success")))
    .all()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  if (
    prevRun &&
    prevRun.listingsFound >= 10 &&
    result.listings.length < prevRun.listingsFound * 0.4
  ) {
    warnings.push(
      `sharp listing-count drop: ${result.listings.length} now vs ${prevRun.listingsFound} in previous successful run — parser or source change?`,
    );
  }
  // Judge photo extraction only on detail-depth records — card-depth ones
  // legitimately lack photos on sources whose result cards have no images.
  const detailDepth = result.listings.filter((l) => l.fetchDepth === "detail");
  if (detailDepth.length >= 10) {
    const withPhotos = detailDepth.filter((l) => (l.photos?.length ?? 0) > 0).length;
    if (withPhotos / detailDepth.length < 0.2) {
      warnings.push(
        `photos missing on ${detailDepth.length - withPhotos}/${detailDepth.length} detail-fetched listings — photo extraction may have broken`,
      );
    }
  }

  // --- missing/stale processing (gated) ---
  let missingCount = 0;
  const staleAllowed = opts.staleUpdates !== false;
  const staleOk =
    staleAllowed && shouldProcessStaleUpdates(status, result.paginationCompleted);
  if (!staleAllowed) {
    warnings.push("missing-listing (stale) processing disabled by flag for this run");
  }
  if (staleOk) {
    const now = nowIso();
    const missingRows = db
      .select({ id: listings.id, staleStatus: listings.staleStatus })
      .from(listings)
      .where(
        and(
          eq(listings.sourceId, source.id),
          lt(listings.lastSeenAt, startedAt),
          ne(listings.staleStatus, "likely_unavailable"),
          eq(listings.listingStatus, "active"),
        ),
      )
      .all();
    db.transaction((tx) => {
      for (const row of missingRows) {
        const next = advanceStaleStatus(row.staleStatus as never);
        if (next === row.staleStatus) continue;
        tx.update(listings)
          .set({
            staleStatus: next,
            missingSince: now, // set on first miss, refreshed as chain advances
            updatedAt: now,
          })
          .where(eq(listings.id, row.id))
          .run();
        tx.insert(listingEvents)
          .values({
            id: newId("evt"),
            listingId: row.id,
            sourceRunId: runId,
            eventType: "stale_change",
            oldValue: row.staleStatus,
            newValue: next,
            note: "not present in a complete successful run",
            createdAt: now,
          })
          .run();
        missingCount++;
      }
    });
  } else if (staleAllowed && status !== "success") {
    warnings.push(
      "missing-listing (stale) processing skipped: run was not fully successful",
    );
  } else if (staleAllowed && result.paginationCompleted !== true) {
    warnings.push(
      "missing-listing (stale) processing skipped: pagination completeness could not be verified",
    );
  }

  // --- duplicate detection across all live listings (db-wide) ---
  let suspectedDuplicates = 0;
  let duplicateGroupsTouched = 0;
  let crossNeighborhoodIds = new Set<string>();
  if (status !== "failed") {
    const candidates: DupeCandidate[] = db
      .select({
        id: listings.id,
        sourceId: listings.sourceId,
        sourceListingId: listings.sourceListingId,
        originalUrl: listings.originalUrl,
        title: listings.title,
        priceMonthly: listings.priceMonthly,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        neighborhood: listings.neighborhood,
        addressRaw: listings.addressRaw,
        addressNormalized: listings.addressNormalized,
        unitNumberPublic: listings.unitNumberPublic,
        photos: listings.photos,
        descriptionHash: listings.descriptionHash,
        lastSeenAt: listings.lastSeenAt,
        firstSeenAt: listings.firstSeenAt,
        detailFetchedAt: listings.detailFetchedAt,
        staleStatus: listings.staleStatus,
        listingStatus: listings.listingStatus,
      })
      .from(listings)
      .where(
        and(
          ne(listings.staleStatus, "likely_unavailable"),
          eq(listings.listingStatus, "active"),
        ),
      )
      .all();
    const dedupe = detectDuplicates(candidates);
    crossNeighborhoodIds = dedupe.crossNeighborhoodDescriptionIds;

    const now = nowIso();
    const groupedIds = new Set<string>();
    const currentGroupIds = new Set<string>();
    db.transaction((tx) => {
      for (const group of dedupe.groups) {
        currentGroupIds.add(group.id);
        tx.insert(duplicateGroups)
          .values({
            id: group.id,
            primaryListingId: group.primaryListingId,
            confidence: group.confidence,
            reasons: group.reasons,
            listingIds: group.memberIds,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: duplicateGroups.id,
            set: {
              primaryListingId: group.primaryListingId,
              confidence: group.confidence,
              reasons: group.reasons,
              listingIds: group.memberIds,
              updatedAt: now,
            },
          })
          .run();
        for (const memberId of group.memberIds) groupedIds.add(memberId);
        tx.update(listings)
          .set({ duplicateGroupId: group.id, updatedAt: now })
          .where(inArray(listings.id, group.memberIds))
          .run();
      }
      // Clear group ids that no longer apply and prune orphaned groups.
      const stillMarked = tx
        .select({ id: listings.id })
        .from(listings)
        .where(isNotNull(listings.duplicateGroupId))
        .all();
      const toClear = stillMarked.map((r) => r.id).filter((id) => !groupedIds.has(id));
      if (toClear.length > 0) {
        tx.update(listings)
          .set({ duplicateGroupId: null, updatedAt: now })
          .where(inArray(listings.id, toClear))
          .run();
      }
      const existingGroups = tx.select({ id: duplicateGroups.id }).from(duplicateGroups).all();
      const orphaned = existingGroups.map((g) => g.id).filter((id) => !currentGroupIds.has(id));
      if (orphaned.length > 0) {
        tx.delete(duplicateGroups).where(inArray(duplicateGroups.id, orphaned)).run();
      }
    });
    suspectedDuplicates = runListingIds.filter((id) => groupedIds.has(id)).length;
    const runIdSet = new Set(runListingIds);
    duplicateGroupsTouched = dedupe.groups.filter((g) =>
      g.memberIds.some((id) => runIdSet.has(id)),
    ).length;
  }

  // --- scam / verify-carefully assessment for listings touched this run ---
  let suspectedScams = 0;
  if (status !== "failed" && runListingIds.length > 0) {
    const activeForBaseline = db
      .select({
        neighborhood: listings.neighborhood,
        bedrooms: listings.bedrooms,
        priceMonthly: listings.priceMonthly,
      })
      .from(listings)
      .where(eq(listings.listingStatus, "active"))
      .all();
    const baselines = computeBaselines(activeForBaseline);
    const rows = db
      .select()
      .from(listings)
      .where(inArray(listings.id, runListingIds))
      .all();
    const now = nowIso();
    db.transaction((tx) => {
      for (const row of rows) {
        // Card-vs-detail price disagreement: the raw card payload retains the
        // search-result price; a large gap from the detail price is a
        // data-inconsistency signal worth a second look.
        let cardDetailPriceMismatch = false;
        const payload = row.rawPayload as { card?: { priceRaw?: string | null } } | null;
        const cardPrice = parsePrice(payload?.card?.priceRaw ?? null);
        if (
          cardPrice != null &&
          row.priceMonthly != null &&
          row.detailFetchedAt != null &&
          Math.abs(cardPrice - row.priceMonthly) / Math.max(cardPrice, row.priceMonthly) > 0.25
        ) {
          cardDetailPriceMismatch = true;
        }
        const assessment = assessListing(
          {
            title: row.title,
            description: row.description,
            priceMonthly: row.priceMonthly,
            squareFeet: row.squareFeet,
            bedrooms: row.bedrooms,
            neighborhood: row.neighborhood,
            addressRaw: row.addressRaw,
            latitude: row.latitude,
            longitude: row.longitude,
            photoCount: row.photos?.length ?? 0,
            descriptionSharedAcrossNeighborhoods: crossNeighborhoodIds.has(row.id),
            cardDetailPriceMismatch,
          },
          baselines,
        );
        if (assessment.level === "verify_carefully") suspectedScams++;
        if (
          assessment.level !== row.scamRiskLevel ||
          JSON.stringify(assessment.warnings) !== JSON.stringify(row.scamWarnings ?? [])
        ) {
          tx.update(listings)
            .set({
              scamRiskLevel: assessment.level,
              scamWarnings: assessment.warnings,
              updatedAt: now,
            })
            .where(eq(listings.id, row.id))
            .run();
        }
      }
    });
  }

  // --- geocoding: cache-first network lookups, then neighborhood fallback ---
  const geocoded = { network: 0, cache: 0, fallback: 0 };
  if (status !== "failed" && runListingIds.length > 0) {
    const needing = db
      .select()
      .from(listings)
      .where(inArray(listings.id, runListingIds))
      .all()
      .filter((r) => r.latitude == null || r.longitude == null);
    const limit = opts.geocodeLimit ?? 20;
    let networkBudget = limit;
    for (const row of needing) {
      let hit = null;
      let fromCache = false;
      if (
        row.addressRaw &&
        source.geocodeEnabled &&
        opts.geocode !== false &&
        networkBudget > 0
      ) {
        const outcome = await geocodeAddress(
          db,
          `${row.addressRaw}`,
          opts.geocodeProvider,
        );
        if (outcome) {
          hit = outcome;
          fromCache = outcome.fromCache;
          if (!outcome.fromCache) networkBudget--;
        } else {
          networkBudget--; // a failed provider call still consumed a request
        }
      }
      hit ??= neighborhoodFallback(row.neighborhood);
      if (hit?.latitude != null && hit.longitude != null) {
        // Fill a missing neighborhood from the authoritative polygon (the
        // reverse lookup is coarser than good source names, so only when blank).
        const filledHood =
          !row.neighborhood && hit.precision !== "neighborhood"
            ? neighborhoodForPoint(hit.longitude, hit.latitude)
            : null;
        db.update(listings)
          .set({
            latitude: hit.latitude,
            longitude: hit.longitude,
            geocodePrecision: hit.precision,
            ...(filledHood ? { neighborhood: filledHood } : {}),
            updatedAt: nowIso(),
          })
          .where(eq(listings.id, row.id))
          .run();
        if (hit.precision === "neighborhood") geocoded.fallback++;
        else if (fromCache) geocoded.cache++;
        else geocoded.network++;
      }
    }
  }

  // --- raw debug artifacts for failed/partial runs ---
  if (status === "failed" || status === "partial") {
    saveDebug("fetch-trace.json", JSON.stringify(fetcher.trace, null, 2));
    saveDebug(
      "normalized-listings.json",
      JSON.stringify(
        { warnings, contract: contract.issues, listings: result.listings },
        null,
        2,
      ),
    );
  }

  // --- record the run ---
  const finishedAt = nowIso();
  db.insert(sourceRuns)
    .values({
      id: runId,
      sourceId: source.id,
      startedAt,
      finishedAt,
      status,
      listingsFound: result.listings.length,
      newListings: newCount,
      changedListings: changedCount,
      priceChangedListings: priceChangedCount,
      missingListings: missingCount,
      suspectedDuplicates,
      suspectedScams,
      pagesVisited: result.pagesVisited,
      detailPagesVisited: result.detailPagesVisited,
      totalListingsReportedBySource: result.totalListingsReportedBySource,
      paginationCompleted: result.paginationCompleted,
      detailExtractionCompleted: result.detailExtractionCompleted,
      staleProcessed: staleOk,
      errorMessage: result.fatalError,
      warnings,
      paginationTrace: {
        pages: result.pageTrace,
        totalReportedBySource: result.totalListingsReportedBySource,
        completed: result.paginationCompleted,
      },
      parserVersion: source.parserVersion,
      htmlHash: result.htmlHash,
      rawDebugPath: fs.existsSync(debugDir) ? debugDir : null,
      createdAt: finishedAt,
    })
    .run();

  await fetcher.close?.();

  return {
    sourceId: source.id,
    sourceName: source.name,
    status,
    runId,
    listingsFound: result.listings.length,
    newListings: newCount,
    changedListings: changedCount,
    unchangedListings: unchangedCount,
    priceChangedListings: priceChangedCount,
    priceHistoryEntries: priceHistoryCount,
    missingListings: missingCount,
    suspectedDuplicates,
    duplicateGroupsTouched,
    suspectedScams,
    pagesVisited: result.pagesVisited,
    detailPagesVisited: result.detailPagesVisited,
    paginationCompleted: result.paginationCompleted,
    detailExtractionCompleted: result.detailExtractionCompleted,
    staleProcessed: staleOk,
    geocoded,
    warnings,
    errorMessage: result.fatalError,
    durationMs: Date.now() - startedAtMs,
  };
}

export async function runAllEnabled(
  db: Db,
  opts: RunOptions = {},
): Promise<RunSummary[]> {
  const all = db.select().from(sources).all();
  const summaries: RunSummary[] = [];
  for (const source of all) {
    if (!source.enabled) {
      summaries.push(skippedSummary(source, "disabled/reference source"));
      continue;
    }
    summaries.push(await runSource(db, source.id, opts));
  }
  return summaries;
}

export function formatSummaryLine(s: RunSummary): string {
  if (s.status === "skipped") {
    return `- ${s.sourceId}: skipped, ${s.skippedReason}`;
  }
  const parts = [
    `${s.listingsFound} listings found`,
    `${s.newListings} new`,
    `${s.changedListings} changed`,
    `${s.unchangedListings} unchanged`,
  ];
  if (s.priceChangedListings > 0) parts.push(`${s.priceChangedListings} price changes`);
  if (s.priceHistoryEntries > 0) parts.push(`${s.priceHistoryEntries} price-history entries`);
  if (s.missingListings > 0) parts.push(`${s.missingListings} newly missing`);
  if (s.suspectedDuplicates > 0) parts.push(`${s.suspectedDuplicates} suspected duplicates`);
  if (s.duplicateGroupsTouched > 0) parts.push(`${s.duplicateGroupsTouched} dupe groups`);
  if (s.suspectedScams > 0) parts.push(`${s.suspectedScams} verify-carefully`);
  parts.push(
    `${s.pagesVisited}p/${s.detailPagesVisited}d`,
    `pagination ${s.paginationCompleted === true ? "complete" : s.paginationCompleted === false ? "INCOMPLETE" : "unknown"}`,
  );
  const geo = s.geocoded;
  if (geo.network + geo.cache + geo.fallback > 0) {
    parts.push(`geocoded ${geo.network} new/${geo.cache} cached/${geo.fallback} hood-level`);
  }
  let line = `- ${s.sourceId}: ${s.status}, ${parts.join(", ")} (${Math.round(s.durationMs / 1000)}s)`;
  if (s.errorMessage) line += `\n    error: ${s.errorMessage.split("\n")[0]}`;
  for (const w of s.warnings) line += `\n    warning: ${w}`;
  return line;
}
