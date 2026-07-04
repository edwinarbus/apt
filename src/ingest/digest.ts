import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { newId, nowIso } from "@/db/client";
import {
  digestRuns,
  listings,
  savedSearches,
  savedSearchMatches,
  sources,
  userListingStates,
} from "@/db/schema";
import {
  evaluateListing,
  type MatchableListing,
  type SavedSearchCriteria,
} from "@/core/match";
import type { UserListingStatus } from "@/core/types";

/**
 * Deterministic saved-search digest. Evaluates every enabled saved search
 * against current active listings using the existing matcher, then reports
 * what's genuinely new since the last digest:
 *   - new matches (never reported before)
 *   - price drops on already-reported matches
 *   - matches that stopped matching (dropped out)
 *
 * This NEVER contacts anyone. It writes a local report (and updates
 * notification bookkeeping). Sending it anywhere is a manual step the user
 * takes — the tool only prepares the digest. `dryRun` computes and prints
 * everything without recording that matches were notified, so re-running is
 * safe and the same items surface again.
 */

export interface DigestMatchItem {
  listingId: string;
  savedSearchId: string;
  savedSearchName: string;
  title: string;
  sourceName: string;
  originalUrl: string;
  neighborhood: string | null;
  priceMonthly: number | null;
  priceEffectiveMonthly: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  distanceKm: number | null;
  unknowns: string[];
  scamRiskLevel: string;
  staleStatus: string;
  duplicateGroupId: string | null;
  /** for price-drop items */
  previousPrice?: number;
}

export interface SavedSearchDigest {
  savedSearchId: string;
  savedSearchName: string;
  newMatches: DigestMatchItem[];
  priceDrops: DigestMatchItem[];
  droppedOut: DigestMatchItem[];
  totalCurrentMatches: number;
}

export interface DigestResult {
  generatedAt: string;
  dryRun: boolean;
  savedSearchesEvaluated: number;
  listingsEvaluated: number;
  perSearch: SavedSearchDigest[];
  totalNewMatches: number;
  totalPriceDrops: number;
  totalDroppedOut: number;
  reportPath: string | null;
}

interface ListingForMatch extends MatchableListing {
  id: string;
  title: string;
  originalUrl: string;
  sourceId: string;
  priceMonthly: number | null;
  scamRiskLevel: string;
  staleStatus: string;
  listingStatus: string;
  duplicateGroupId: string | null;
  userStatus: UserListingStatus | null;
}

async function loadMatchableListings(db: Db): Promise<ListingForMatch[]> {
  const rows = await db.select().from(listings).all();
  const states = await db.select().from(userListingStates).all();
  const stateByListing = new Map(states.map((s) => [s.listingId, s.status]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    originalUrl: r.originalUrl,
    sourceId: r.sourceId,
    priceMonthly: r.priceMonthly,
    priceEffectiveMonthly: r.priceEffectiveMonthly,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    squareFeet: r.squareFeet,
    pricePerSquareFoot: r.pricePerSquareFoot,
    neighborhood: r.neighborhood,
    catsAllowed: r.catsAllowed,
    dogsAllowed: r.dogsAllowed,
    laundryNormalized: r.laundryNormalized,
    parkingNormalized: r.parkingNormalized,
    availableDate: r.availableDate,
    latitude: r.latitude,
    longitude: r.longitude,
    description: r.description,
    scamRiskLevel: r.scamRiskLevel,
    staleStatus: r.staleStatus,
    listingStatus: r.listingStatus,
    duplicateGroupId: r.duplicateGroupId,
    userStatus: (stateByListing.get(r.id) as UserListingStatus | undefined) ?? null,
  }));
}

export async function computeDigest(db: Db, opts: { dryRun?: boolean } = {}): Promise<DigestResult> {
  const dryRun = opts.dryRun ?? false;
  const now = nowIso();
  const searches = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.enabled, true))
    .all();
  const allListings = await loadMatchableListings(db);
  const sourceNameById = new Map(
    (await db.select({ id: sources.id, name: sources.name }).from(sources).all())
      .map((s) => [s.id, s.name]),
  );

  // Only match against listings that are live and not user-excluded — a
  // digest should never resurface a hidden or likely-unavailable listing.
  const eligibleListings = allListings.filter(
    (l) =>
      l.listingStatus === "active" &&
      l.staleStatus !== "likely_unavailable" &&
      l.userStatus !== "hidden" &&
      l.userStatus !== "not_a_fit" &&
      l.userStatus !== "rented_elsewhere",
  );

  const perSearch: SavedSearchDigest[] = [];

  for (const search of searches) {
    const criteria = search.criteria as SavedSearchCriteria;
    const existingMatches = await db
      .select()
      .from(savedSearchMatches)
      .where(eq(savedSearchMatches.savedSearchId, search.id))
      .all();
    const existingByListing = new Map(existingMatches.map((m) => [m.listingId, m]));

    const newMatches: DigestMatchItem[] = [];
    const priceDrops: DigestMatchItem[] = [];
    const currentMatchIds = new Set<string>();

    for (const listing of eligibleListings) {
      const result = evaluateListing(listing, criteria, listing.userStatus);
      if (!result.matched) continue;
      currentMatchIds.add(listing.id);

      const item: DigestMatchItem = {
        listingId: listing.id,
        savedSearchId: search.id,
        savedSearchName: search.name,
        title: listing.title,
        sourceName: sourceNameById.get(listing.sourceId) ?? listing.sourceId,
        originalUrl: listing.originalUrl,
        neighborhood: listing.neighborhood,
        priceMonthly: listing.priceMonthly,
        priceEffectiveMonthly: listing.priceEffectiveMonthly,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        distanceKm: result.distanceKm,
        unknowns: result.unknowns,
        scamRiskLevel: listing.scamRiskLevel,
        staleStatus: listing.staleStatus,
        duplicateGroupId: listing.duplicateGroupId,
      };

      const existing = existingByListing.get(listing.id);
      if (!existing || existing.notifiedAt == null) {
        newMatches.push(item);
      } else if (
        listing.priceMonthly != null &&
        existing.notifiedPriceMonthly != null &&
        listing.priceMonthly < existing.notifiedPriceMonthly
      ) {
        priceDrops.push({ ...item, previousPrice: existing.notifiedPriceMonthly });
      }

      // Upsert the match row (bookkeeping happens regardless of dry-run so
      // firstMatchedAt is accurate; notifiedAt is only advanced on real runs).
      if (!dryRun) {
        if (existing) {
          await db
            .update(savedSearchMatches)
            .set({
              lastMatchedAt: now,
              stillMatching: true,
              distanceKm: result.distanceKm,
              unknowns: result.unknowns,
            })
            .where(eq(savedSearchMatches.id, existing.id))
            .run();
        } else {
          await db
            .insert(savedSearchMatches)
            .values({
              id: newId("ssm"),
              savedSearchId: search.id,
              listingId: listing.id,
              firstMatchedAt: now,
              lastMatchedAt: now,
              notifiedAt: null,
              notifiedPriceMonthly: null,
              stillMatching: true,
              distanceKm: result.distanceKm,
              unknowns: result.unknowns,
            })
            .run();
        }
      }
    }

    // Matches that were previously matching but no longer are.
    const droppedOut: DigestMatchItem[] = [];
    for (const existing of existingMatches) {
      if (currentMatchIds.has(existing.listingId)) continue;
      if (!existing.stillMatching) continue; // already reported as dropped
      const listing = allListings.find((l) => l.id === existing.listingId);
      droppedOut.push({
        listingId: existing.listingId,
        savedSearchId: search.id,
        savedSearchName: search.name,
        title: listing?.title ?? "(removed)",
        sourceName: listing ? (sourceNameById.get(listing.sourceId) ?? listing.sourceId) : "?",
        originalUrl: listing?.originalUrl ?? "",
        neighborhood: listing?.neighborhood ?? null,
        priceMonthly: listing?.priceMonthly ?? null,
        priceEffectiveMonthly: listing?.priceEffectiveMonthly ?? null,
        bedrooms: listing?.bedrooms ?? null,
        bathrooms: listing?.bathrooms ?? null,
        distanceKm: null,
        unknowns: [],
        scamRiskLevel: listing?.scamRiskLevel ?? "none",
        staleStatus: listing?.staleStatus ?? "unknown",
        duplicateGroupId: listing?.duplicateGroupId ?? null,
      });
      if (!dryRun) {
        await db
          .update(savedSearchMatches)
          .set({ stillMatching: false, lastMatchedAt: existing.lastMatchedAt })
          .where(eq(savedSearchMatches.id, existing.id))
          .run();
      }
    }

    perSearch.push({
      savedSearchId: search.id,
      savedSearchName: search.name,
      newMatches,
      priceDrops,
      droppedOut,
      totalCurrentMatches: currentMatchIds.size,
    });
  }

  // Mark everything reported this run as notified (real runs only).
  if (!dryRun) {
    for (const s of perSearch) {
      const toNotify = [...s.newMatches, ...s.priceDrops];
      for (const item of toNotify) {
        await db
          .update(savedSearchMatches)
          .set({ notifiedAt: now, notifiedPriceMonthly: item.priceMonthly })
          .where(
            and(
              eq(savedSearchMatches.savedSearchId, s.savedSearchId),
              eq(savedSearchMatches.listingId, item.listingId),
            ),
          )
          .run();
      }
    }
  }

  const result: DigestResult = {
    generatedAt: now,
    dryRun,
    savedSearchesEvaluated: searches.length,
    listingsEvaluated: eligibleListings.length,
    perSearch,
    totalNewMatches: perSearch.reduce((a, s) => a + s.newMatches.length, 0),
    totalPriceDrops: perSearch.reduce((a, s) => a + s.priceDrops.length, 0),
    totalDroppedOut: perSearch.reduce((a, s) => a + s.droppedOut.length, 0),
    reportPath: null,
  };

  if (!dryRun) {
    result.reportPath = writeReport(result);
    await db
      .insert(digestRuns)
      .values({
        id: newId("dig"),
        createdAt: now,
        savedSearchesEvaluated: result.savedSearchesEvaluated,
        listingsEvaluated: result.listingsEvaluated,
        newMatches: result.totalNewMatches,
        priceDropMatches: result.totalPriceDrops,
        droppedMatches: result.totalDroppedOut,
        dryRun: false,
        reportPath: result.reportPath,
      })
      .run();
  }

  return result;
}

/** Write a human-readable Markdown digest under data/digests/. Never sent anywhere. */
function writeReport(result: DigestResult): string | null {
  try {
    const dir = path.join(process.cwd(), "data", "digests");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = result.generatedAt.replace(/[:.]/g, "-");
    const file = path.join(dir, `digest-${stamp}.md`);
    fs.writeFileSync(file, formatDigestMarkdown(result));
    return file;
  } catch {
    return null;
  }
}

const money = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;

function formatItem(item: DigestMatchItem): string {
  const beds = item.bedrooms == null ? "?bd" : item.bedrooms === 0 ? "studio" : `${item.bedrooms}bd`;
  const price =
    item.priceEffectiveMonthly != null && item.priceEffectiveMonthly !== item.priceMonthly
      ? `${money(item.priceEffectiveMonthly)} eff (${money(item.priceMonthly)})`
      : money(item.priceMonthly);
  const flags: string[] = [];
  if (item.previousPrice) flags.push(`was ${money(item.previousPrice)}`);
  if (item.scamRiskLevel === "verify_carefully") flags.push("⚠ verify carefully");
  if (item.duplicateGroupId) flags.push("possible duplicate");
  if (item.staleStatus.startsWith("missing")) flags.push("missing from source");
  if (item.unknowns.length) flags.push(`verify: ${item.unknowns.join(", ")}`);
  const dist = item.distanceKm != null ? `, ${item.distanceKm}km` : "";
  const suffix = flags.length ? ` — ${flags.join("; ")}` : "";
  return `- ${price} · ${beds} · ${item.neighborhood ?? "SF"}${dist} · ${item.sourceName}${suffix}\n  ${item.title}\n  ${item.originalUrl}`;
}

export function formatDigestMarkdown(result: DigestResult): string {
  const lines: string[] = [];
  lines.push(`# Apt digest — ${result.generatedAt.slice(0, 16).replace("T", " ")}`);
  lines.push("");
  lines.push(
    `${result.totalNewMatches} new match${result.totalNewMatches === 1 ? "" : "es"}, ` +
      `${result.totalPriceDrops} price drop${result.totalPriceDrops === 1 ? "" : "s"}, ` +
      `${result.totalDroppedOut} dropped out — across ${result.savedSearchesEvaluated} saved ` +
      `search${result.savedSearchesEvaluated === 1 ? "" : "es"} (${result.listingsEvaluated} live listings evaluated).`,
  );
  lines.push("");
  lines.push(
    "_Verify availability, rent, fees, and terms on the original listing before contacting anyone. " +
      "This digest is not sent to anyone automatically._",
  );

  for (const s of result.perSearch) {
    lines.push("");
    lines.push(`## ${s.savedSearchName}`);
    lines.push(`_${s.totalCurrentMatches} current match${s.totalCurrentMatches === 1 ? "" : "es"}_`);
    if (s.newMatches.length) {
      lines.push("");
      lines.push(`### New (${s.newMatches.length})`);
      for (const item of s.newMatches) lines.push(formatItem(item));
    }
    if (s.priceDrops.length) {
      lines.push("");
      lines.push(`### Price drops (${s.priceDrops.length})`);
      for (const item of s.priceDrops) lines.push(formatItem(item));
    }
    if (s.droppedOut.length) {
      lines.push("");
      lines.push(`### No longer matching (${s.droppedOut.length})`);
      for (const item of s.droppedOut) lines.push(formatItem(item));
    }
    if (!s.newMatches.length && !s.priceDrops.length && !s.droppedOut.length) {
      lines.push("");
      lines.push("_Nothing new._");
    }
  }
  return lines.join("\n") + "\n";
}

export function formatDigestConsole(result: DigestResult): string {
  const lines: string[] = [];
  lines.push(
    `Digest ${result.dryRun ? "(dry run) " : ""}— ${result.totalNewMatches} new, ` +
      `${result.totalPriceDrops} price drops, ${result.totalDroppedOut} dropped out ` +
      `(${result.listingsEvaluated} live listings, ${result.savedSearchesEvaluated} saved searches)`,
  );
  for (const s of result.perSearch) {
    lines.push("");
    lines.push(`▸ ${s.savedSearchName}: ${s.totalCurrentMatches} current match(es)`);
    if (!s.newMatches.length && !s.priceDrops.length && !s.droppedOut.length) {
      lines.push("  (nothing new)");
    }
    for (const item of s.newMatches) lines.push("  NEW      " + oneLine(item));
    for (const item of s.priceDrops) lines.push("  ▼ DROP   " + oneLine(item));
    for (const item of s.droppedOut) lines.push("  gone     " + oneLine(item));
  }
  if (result.reportPath) {
    lines.push("");
    lines.push(`Full report written to ${result.reportPath}`);
  }
  return lines.join("\n");
}

function oneLine(item: DigestMatchItem): string {
  const beds = item.bedrooms == null ? "?bd" : item.bedrooms === 0 ? "studio" : `${item.bedrooms}bd`;
  const prev = item.previousPrice ? ` (was ${money(item.previousPrice)})` : "";
  const flag = item.scamRiskLevel === "verify_carefully" ? " ⚠" : "";
  return `${money(item.priceEffectiveMonthly ?? item.priceMonthly)}${prev} · ${beds} · ${item.neighborhood ?? "SF"} · ${item.sourceName}${flag} — ${item.title.slice(0, 50)}`;
}
