import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nowIso } from "@/db/client";
import { listingEnrichment, listings, sources } from "@/db/schema";
import { hasPrice } from "@/core/normalize";
import type { EnrichmentClient } from "./client";
import { estimateCostUsd } from "./client";
import { SCHEMA_VERSION, type EnrichmentInput } from "./schema";

/**
 * Orchestrates the optional AI enrichment pass. Completely separate from the
 * deterministic ingestion runner — you invoke it manually (`npm run enrich`).
 *
 * Selection: a listing is (re)enriched when it has no enrichment row, its
 * stored enrichment used an older schema version, its previous attempt errored,
 * or its content hash changed since it was last enriched. Unchanged, already-
 * enriched listings are skipped — so re-running is cheap and idempotent.
 */

export interface EnrichOptions {
  /** enrich a single listing by id */
  listingId?: string;
  /** cap how many listings to enrich this run */
  limit?: number;
  /** stop before exceeding this estimated USD spend */
  costCapUsd?: number;
  /** re-enrich even if the content hash is unchanged */
  force?: boolean;
  /** don't call the API or write; just report what would be enriched */
  dryRun?: boolean;
  /** include likely-unavailable / non-active listings (default: skip them) */
  includeInactive?: boolean;
  log?: (message: string) => void;
}

export interface EnrichSummary {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedUnchanged: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  dryRun: boolean;
  model: string | null;
  errors: Array<{ listingId: string; error: string }>;
}

interface Candidate {
  input: EnrichmentInput;
  contentHash: string;
}

export async function selectCandidates(
  db: Db,
  opts: EnrichOptions,
): Promise<{ candidates: Candidate[]; skippedUnchanged: number }> {
  const sourceNameById = new Map(
    (await db.select({ id: sources.id, name: sources.name }).from(sources).all())
      .map((s) => [s.id, s.name]),
  );

  const rows = opts.listingId
    ? await db.select().from(listings).where(eq(listings.id, opts.listingId)).all()
    : await db.select().from(listings).all();

  const existing = new Map(
    (await db.select().from(listingEnrichment).all()).map((e) => [e.listingId, e]),
  );

  const candidates: Candidate[] = [];
  let skippedUnchanged = 0;

  for (const row of rows) {
    if (!opts.includeInactive) {
      if (row.listingStatus !== "active" || row.staleStatus === "likely_unavailable") {
        continue;
      }
    }
    if (!hasPrice(row.priceMonthly, row.priceEffectiveMonthly)) continue;
    const prior = existing.get(row.id);
    const needs =
      opts.force ||
      !prior ||
      prior.error != null ||
      prior.schemaVersion !== SCHEMA_VERSION ||
      prior.contentHashAtEnrichment !== row.contentHash;
    if (!needs) {
      skippedUnchanged++;
      continue;
    }
    candidates.push({
      contentHash: row.contentHash,
      input: {
        listingId: row.id,
        title: row.title,
        description: row.description,
        propertyName: row.propertyName,
        priceMonthly: row.priceMonthly,
        priceRaw: row.priceRaw,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        squareFeet: row.squareFeet,
        neighborhood: row.neighborhood,
        addressRaw: row.addressRaw,
        sourceName: sourceNameById.get(row.sourceId) ?? row.sourceId,
        amenitiesRaw: row.amenitiesRaw,
        concessionsRaw: row.concessionsRaw,
        depositRaw: row.depositRaw,
        applicationFeeRaw: row.applicationFeeRaw,
        brokerFeeRaw: row.brokerFeeRaw,
        leaseTermRaw: row.leaseTermRaw,
        availableDate: row.availableDate,
        petPolicyRaw: row.petPolicyRaw,
        laundryRaw: row.laundryRaw,
        parkingRaw: row.parkingRaw,
        deterministicScamWarnings: row.scamWarnings,
      },
    });
  }
  return { candidates, skippedUnchanged };
}

export async function enrichListings(
  db: Db,
  client: EnrichmentClient,
  opts: EnrichOptions = {},
): Promise<EnrichSummary> {
  const log = opts.log ?? (() => {});
  const { candidates, skippedUnchanged } = await selectCandidates(db, opts);

  const summary: EnrichSummary = {
    candidates: candidates.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedUnchanged,
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
      `dry run: ${candidates.length} listing(s) would be enriched with ${client.model}` +
        (opts.limit != null ? ` (limited to ${toProcess.length})` : ""),
    );
    return summary;
  }

  for (const cand of toProcess) {
    if (opts.costCapUsd != null && summary.costUsd >= opts.costCapUsd) {
      log(`cost cap $${opts.costCapUsd} reached — stopping (spent ~$${summary.costUsd.toFixed(4)})`);
      break;
    }
    summary.attempted++;
    const result = await client.enrichOne(cand.input);
    const cost = estimateCostUsd(result.model, result.usage);
    summary.inputTokens += result.usage.inputTokens;
    summary.outputTokens += result.usage.outputTokens;
    summary.costUsd += cost;

    const now = nowIso();
    const rowBase = {
      listingId: cand.input.listingId,
      model: result.model,
      schemaVersion: SCHEMA_VERSION,
      contentHashAtEnrichment: cand.contentHash,
      enrichedAt: now,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: cost,
    };

    if (result.data) {
      summary.succeeded++;
      await db
        .insert(listingEnrichment)
        .values({
          ...rowBase,
          summary: result.data.summary,
          aiRiskLevel: result.data.riskLevel,
          data: result.data,
          error: null,
        })
        .onConflictDoUpdate({
          target: listingEnrichment.listingId,
          set: {
            ...rowBase,
            summary: result.data.summary,
            aiRiskLevel: result.data.riskLevel,
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
        .insert(listingEnrichment)
        .values({ ...rowBase, summary: null, aiRiskLevel: null, data: null, error: result.error })
        .onConflictDoUpdate({
          target: listingEnrichment.listingId,
          set: { error: result.error, enrichedAt: now, model: result.model },
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

export function formatEnrichSummary(s: EnrichSummary): string {
  if (s.dryRun) {
    return `Dry run — ${s.candidates} listing(s) need enrichment (${s.skippedUnchanged} already up to date). Model: ${s.model}. Nothing was called or written.`;
  }
  const lines = [
    `Enrichment complete (${s.model}):`,
    `- ${s.succeeded} enriched, ${s.failed} failed, ${s.skippedUnchanged} skipped (unchanged)`,
    `- ${s.candidates} were eligible; ${s.attempted} attempted this run`,
    `- ${s.inputTokens.toLocaleString()} input / ${s.outputTokens.toLocaleString()} output tokens`,
    `- estimated cost: $${s.costUsd.toFixed(4)}`,
  ];
  if (s.errors.length > 0) {
    lines.push(`- first errors: ${s.errors.slice(0, 3).map((e) => e.error).join(" | ")}`);
  }
  return lines.join("\n");
}
