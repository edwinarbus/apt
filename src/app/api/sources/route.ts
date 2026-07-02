import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { listings, sourceRuns, sources } from "@/db/schema";
import type {
  SourceDashboardEntry,
  SourceRunPayload,
  SourcesResponse,
} from "@/lib/api-types";
import type { SourceRunRow } from "@/db/schema";

export const dynamic = "force-dynamic";

function toRunPayload(run: SourceRunRow): SourceRunPayload {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status as never,
    listingsFound: run.listingsFound,
    newListings: run.newListings,
    changedListings: run.changedListings,
    priceChangedListings: run.priceChangedListings,
    missingListings: run.missingListings,
    suspectedDuplicates: run.suspectedDuplicates,
    suspectedScams: run.suspectedScams,
    pagesVisited: run.pagesVisited,
    detailPagesVisited: run.detailPagesVisited,
    totalListingsReportedBySource: run.totalListingsReportedBySource,
    paginationCompleted: run.paginationCompleted,
    detailExtractionCompleted: run.detailExtractionCompleted,
    staleProcessed: run.staleProcessed,
    errorMessage: run.errorMessage,
    warnings: run.warnings ?? [],
  };
}

export async function GET() {
  const db = getDb();
  const sourceRows = db.select().from(sources).all();
  const listingRows = db
    .select({ sourceId: listings.sourceId, staleStatus: listings.staleStatus })
    .from(listings)
    .all();

  const totals = new Map<string, { total: number; active: number }>();
  for (const l of listingRows) {
    const t = totals.get(l.sourceId) ?? { total: 0, active: 0 };
    t.total++;
    if (l.staleStatus === "active") t.active++;
    totals.set(l.sourceId, t);
  }

  const entries: SourceDashboardEntry[] = sourceRows.map((s) => {
    const runs = db
      .select()
      .from(sourceRuns)
      .where(eq(sourceRuns.sourceId, s.id))
      .orderBy(desc(sourceRuns.startedAt))
      .limit(8)
      .all();
    const t = totals.get(s.id) ?? { total: 0, active: 0 };
    return {
      id: s.id,
      name: s.name,
      sourceSystem: s.sourceSystem,
      adapterType: s.adapterType,
      priority: s.priority,
      enabled: s.enabled,
      listingUrl: s.listingUrl,
      websiteUrl: s.websiteUrl,
      needsJavaScript: s.needsJavaScript,
      blocksAutomation: s.blocksAutomation,
      safeForPersonalLowFrequencyFetching: s.safeForPersonalLowFrequencyFetching,
      permissionStatus: s.permissionStatus,
      robotsStatus: s.robotsStatus,
      robotsCheckedAt: s.robotsCheckedAt,
      robotsNotes: s.robotsNotes,
      sourceStatusNotes: s.sourceStatusNotes,
      notes: s.notes,
      crawlIntervalHours: s.crawlIntervalHours,
      activeListings: t.active,
      totalListings: t.total,
      lastRun: runs[0] ? toRunPayload(runs[0]) : null,
      recentRuns: runs.map(toRunPayload),
    };
  });

  const body: SourcesResponse = {
    sources: entries,
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
