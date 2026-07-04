import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nowIso } from "@/db/client";
import { listings, listingVision } from "@/db/schema";
import { estimateCostUsd, type VisionClient } from "./client";
import {
  buildVisionSearchText,
  VISION_SCHEMA_VERSION,
  type VisionInput,
} from "./schema";

/**
 * Orchestrates the optional AI vision pass. Completely separate from the
 * deterministic ingestion runner — you invoke it manually (`npm run vision`),
 * and a future managed agent can call the same selection + write logic per new
 * listing it picks up.
 *
 * Selection: a listing is (re)analyzed when it has photos AND (no vision row,
 * an older schema version, a previous error, or its photoHash changed since it
 * was last analyzed). Listings with no usable images, and unchanged already-
 * analyzed listings, are skipped — so re-running is cheap and idempotent.
 */

export const DEFAULT_MAX_IMAGES = 6;

export interface VisionOptions {
  /** analyze a single listing by id */
  listingId?: string;
  /** cap how many listings to analyze this run */
  limit?: number;
  /** stop before exceeding this estimated USD spend */
  costCapUsd?: number;
  /** re-analyze even if the photoHash is unchanged */
  force?: boolean;
  /** don't call the API or write; just report what would be analyzed */
  dryRun?: boolean;
  /** include likely-unavailable / non-active listings (default: skip them) */
  includeInactive?: boolean;
  /** max images to send per listing (default DEFAULT_MAX_IMAGES) */
  maxImages?: number;
  log?: (message: string) => void;
}

export interface VisionSummary {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedUnchanged: number;
  skippedNoPhotos: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  dryRun: boolean;
  model: string | null;
  errors: Array<{ listingId: string; error: string }>;
}

interface Candidate {
  input: VisionInput;
  photoHash: string | null;
}

/** Dedupe + http-filter + cap the images we'll send for one listing. */
export function selectImageUrls(
  primaryPhotoUrl: string | null,
  photos: string[] | null,
  maxImages: number,
): string[] {
  const ordered = [primaryPhotoUrl, ...(photos ?? [])].filter(
    (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
  );
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const u of ordered) {
    if (seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
    if (unique.length >= maxImages) break;
  }
  return unique;
}

export async function selectVisionCandidates(
  db: Db,
  opts: VisionOptions,
): Promise<{ candidates: Candidate[]; skippedUnchanged: number; skippedNoPhotos: number }> {
  const maxImages = opts.maxImages ?? DEFAULT_MAX_IMAGES;

  const rows = opts.listingId
    ? await db.select().from(listings).where(eq(listings.id, opts.listingId)).all()
    : await db.select().from(listings).all();

  const existing = new Map(
    (await db.select().from(listingVision).all()).map((v) => [v.listingId, v]),
  );

  const candidates: Candidate[] = [];
  let skippedUnchanged = 0;
  let skippedNoPhotos = 0;

  for (const row of rows) {
    if (!opts.includeInactive) {
      if (row.listingStatus !== "active" || row.staleStatus === "likely_unavailable") {
        continue;
      }
    }
    const imageUrls = selectImageUrls(row.primaryPhotoUrl, row.photos, maxImages);
    if (imageUrls.length === 0) {
      skippedNoPhotos++;
      continue;
    }
    const prior = existing.get(row.id);
    const photoHash = row.photoHash ?? null;
    const needs =
      opts.force ||
      !prior ||
      prior.error != null ||
      prior.schemaVersion !== VISION_SCHEMA_VERSION ||
      prior.photoHashAtVision !== photoHash;
    if (!needs) {
      skippedUnchanged++;
      continue;
    }
    candidates.push({
      photoHash,
      input: {
        listingId: row.id,
        title: row.title,
        neighborhood: row.neighborhood,
        propertyName: row.propertyName,
        description: row.description,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        squareFeet: row.squareFeet,
        priceRaw: row.priceRaw,
        amenitiesRaw: row.amenitiesRaw,
        imageUrls,
      },
    });
  }
  return { candidates, skippedUnchanged, skippedNoPhotos };
}

export async function runVision(
  db: Db,
  client: VisionClient,
  opts: VisionOptions = {},
): Promise<VisionSummary> {
  const log = opts.log ?? (() => {});
  const { candidates, skippedUnchanged, skippedNoPhotos } = await selectVisionCandidates(db, opts);

  const summary: VisionSummary = {
    candidates: candidates.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedUnchanged,
    skippedNoPhotos,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    dryRun: opts.dryRun ?? false,
    model: client.model,
    errors: [],
  };

  const toProcess = opts.limit != null ? candidates.slice(0, opts.limit) : candidates;

  if (opts.dryRun) {
    log(
      `dry run: ${candidates.length} listing(s) would be analyzed with ${client.model}` +
        (opts.limit != null ? ` (limited to ${toProcess.length})` : "") +
        ` — ${skippedNoPhotos} skipped for no photos`,
    );
    return summary;
  }

  for (const cand of toProcess) {
    if (opts.costCapUsd != null && summary.costUsd >= opts.costCapUsd) {
      log(`cost cap $${opts.costCapUsd} reached — stopping (spent ~$${summary.costUsd.toFixed(4)})`);
      break;
    }
    summary.attempted++;
    const result = await client.analyzeOne(cand.input);
    const cost = estimateCostUsd(result.model, result.usage);
    summary.inputTokens += result.usage.inputTokens;
    summary.outputTokens += result.usage.outputTokens;
    summary.costUsd += cost;

    const now = nowIso();
    const rowBase = {
      listingId: cand.input.listingId,
      model: result.model,
      schemaVersion: VISION_SCHEMA_VERSION,
      photoHashAtVision: cand.photoHash,
      imageCount: result.imageCount,
      analyzedAt: now,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: cost,
    };

    if (result.data) {
      summary.succeeded++;
      const searchText = buildVisionSearchText(result.data);
      await db
        .insert(listingVision)
        .values({
          ...rowBase,
          visualSummary: result.data.visualSummary,
          features: result.data.features,
          searchText,
          data: result.data,
          error: null,
        })
        .onConflictDoUpdate({
          target: listingVision.listingId,
          set: {
            ...rowBase,
            visualSummary: result.data.visualSummary,
            features: result.data.features,
            searchText,
            data: result.data,
            error: null,
          },
        })
        .run();
    } else {
      summary.failed++;
      summary.errors.push({ listingId: cand.input.listingId, error: result.error ?? "unknown error" });
      // Record the failure (so a good next run retries it) but keep any prior data.
      await db
        .insert(listingVision)
        .values({
          ...rowBase,
          visualSummary: null,
          features: null,
          searchText: null,
          data: null,
          error: result.error,
        })
        .onConflictDoUpdate({
          target: listingVision.listingId,
          set: { error: result.error, analyzedAt: now, model: result.model },
        })
        .run();
      log(`  failed ${cand.input.listingId}: ${result.error}`);
    }
    if (summary.attempted % 10 === 0) {
      log(`  ${summary.attempted}/${toProcess.length} done, ~$${summary.costUsd.toFixed(4)} spent`);
    }
  }

  return summary;
}

export function formatVisionSummary(s: VisionSummary): string {
  if (s.dryRun) {
    return `Dry run — ${s.candidates} listing(s) need vision analysis (${s.skippedUnchanged} already up to date, ${s.skippedNoPhotos} have no photos). Model: ${s.model}. Nothing was called or written.`;
  }
  const lines = [
    `Vision complete (${s.model}):`,
    `- ${s.succeeded} analyzed, ${s.failed} failed, ${s.skippedUnchanged} skipped (unchanged), ${s.skippedNoPhotos} no photos`,
    `- ${s.candidates} were eligible; ${s.attempted} attempted this run`,
    `- ${s.inputTokens.toLocaleString()} input / ${s.outputTokens.toLocaleString()} output tokens`,
    `- estimated cost: $${s.costUsd.toFixed(4)}`,
  ];
  if (s.errors.length > 0) {
    lines.push(`- first errors: ${s.errors.slice(0, 3).map((e) => e.error).join(" | ")}`);
  }
  return lines.join("\n");
}
