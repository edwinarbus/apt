import { createDb } from "@/db/client";
import { AnthropicEnrichmentClient, DEFAULT_ENRICH_MODEL } from "@/enrich/client";
import { enrichListings, formatEnrichSummary } from "@/enrich/enricher";

/**
 * Optional AI enrichment CLI (uses the Claude API — costs money).
 *
 *   npm run enrich -- --dry-run            show what would be enriched, no API calls
 *   npm run enrich -- --limit 20           enrich up to 20 changed/new listings
 *   npm run enrich -- --source-listing <id>  enrich one listing by id
 *   npm run enrich -- --cost-cap 1.00      stop before ~$1.00 of spend
 *   npm run enrich -- --force              re-enrich even if unchanged
 *   npm run enrich -- --all                no per-run limit (enrich every eligible listing)
 *
 * Model: $APT_ENRICH_MODEL (default claude-opus-4-8). For this high-volume,
 * bounded extraction task, `APT_ENRICH_MODEL=claude-haiku-4-5` is ~5x cheaper.
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */

function numFlag(args: string[], name: string): number | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) {
    const v = Number(args[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const all = args.includes("--all");
  const includeInactive = args.includes("--include-inactive");
  const idIdx = args.indexOf("--source-listing");
  const listingId = idIdx >= 0 ? args[idIdx + 1] : undefined;
  const limit = all ? undefined : (numFlag(args, "--limit") ?? 25);
  const costCapUsd = numFlag(args, "--cost-cap");

  const model = process.env.APT_ENRICH_MODEL ?? DEFAULT_ENRICH_MODEL;

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "No ANTHROPIC_API_KEY found.\n" +
        "Enrichment uses the Claude API. Set a key and re-run:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  npm run enrich -- --limit 10\n" +
        "(Or run `ant auth login` if you use the Anthropic CLI.)\n" +
        "Use `npm run enrich -- --dry-run` to preview what would be enriched without a key.",
    );
    process.exit(1);
  }

  const db = createDb();
  const client = new AnthropicEnrichmentClient({ model });
  const log = (m: string) => console.log(m);

  if (!dryRun) {
    console.log(
      `Enriching with ${model}` +
        (limit != null ? ` (up to ${limit} listings` : " (all eligible listings") +
        (costCapUsd != null ? `, cost cap $${costCapUsd}` : "") +
        `)…`,
    );
  }

  const summary = await enrichListings(db, client, {
    listingId,
    limit,
    costCapUsd,
    force,
    dryRun,
    includeInactive,
    log,
  });
  console.log("\n" + formatEnrichSummary(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
