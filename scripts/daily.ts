import "@/lib/load-env";
import { createDb } from "@/db/client";
import { formatSummaryLine, runAllEnabled } from "@/ingest/runner";
import { computeDigest, formatDigestConsole } from "@/ingest/digest";
import { enrichListings, formatEnrichSummary } from "@/enrich/enricher";
import { AnthropicEnrichmentClient } from "@/enrich/client";
import { runVision, formatVisionSummary } from "@/vision/vision";
import { AnthropicVisionClient } from "@/vision/client";

/**
 * The scheduled daily loop — the single entry point a cron/launchd job (or the
 * overnight Porter managed agent) runs to pick up new listings overnight:
 *
 *   ingest every enabled source  →  enrich new/changed  →  vision new/changed
 *   →  saved-search digest
 *
 * Ingest is always run. Enrichment and vision are AI passes (they cost money),
 * so they run only when an API key is present and are bounded by a cost cap;
 * the job degrades gracefully to ingest + digest without a key. It stays
 * conservative (the runner caps request volume and respects robots.txt) and it
 * never contacts anyone — the digest is a local report.
 *
 *   npm run daily                              full pipeline
 *   npm run daily -- --no-geocode
 *   npm run daily -- --no-enrich --no-vision   ingest + digest only
 *   npm run daily -- --enrich-cap 0.50 --vision-cap 1.00
 */

function numFlag(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) {
    const v = Number(args[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const noGeocode = args.includes("--no-geocode");
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const doEnrich = !args.includes("--no-enrich") && hasKey;
  const doVision = !args.includes("--no-vision") && hasKey;
  // Enrichment used to default to a $1.00 cap — half of vision's — despite
  // running on the exact same new/changed set. A single busy Craigslist night
  // (240 new listings observed) costs ~$0.005/listing to enrich, so $1.00 cut
  // off partway through and left ~22% of that night's listings with no AI
  // summary, while vision's more generous cap covered nearly all of them.
  // Matching vision's $2.00 comfortably covers a busy night with headroom.
  const enrichCap = numFlag(args, "--enrich-cap", 2.0);
  const visionCap = numFlag(args, "--vision-cap", 2.0);
  const db = await createDb();
  const log = (m: string) => console.log(`  ${m}`);
  const stamp = () => new Date().toISOString();

  console.log(`[${stamp()}] daily run: ingesting enabled sources…`);
  const summaries = await runAllEnabled(db, { geocode: !noGeocode, log });
  for (const s of summaries) console.log(formatSummaryLine(s));

  if (doEnrich) {
    console.log(`\n[${stamp()}] enriching new/changed listings (cap $${enrichCap})…`);
    const summary = await enrichListings(db, new AnthropicEnrichmentClient(), {
      costCapUsd: enrichCap,
      log,
    });
    console.log(formatEnrichSummary(summary));
  } else if (!hasKey) {
    console.log(`\n[${stamp()}] skipping enrichment + vision (no ANTHROPIC_API_KEY)`);
  }

  if (doVision) {
    console.log(`\n[${stamp()}] analyzing photos for new/changed listings (cap $${visionCap})…`);
    const summary = await runVision(db, new AnthropicVisionClient(), {
      costCapUsd: visionCap,
      log,
    });
    console.log(formatVisionSummary(summary));
  }

  console.log(`\n[${stamp()}] computing saved-search digest…`);
  const digest = await computeDigest(db, { dryRun: false });
  console.log(formatDigestConsole(digest));

  const failed = summaries.filter((s) => s.status === "failed").length;
  const attempted = summaries.filter((s) => s.status !== "skipped").length;
  // Non-zero exit if every attempted source failed, so a scheduler can alert.
  if (attempted > 0 && failed === attempted) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
