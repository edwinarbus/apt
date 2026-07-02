import "@/lib/load-env";
import { createDb } from "@/db/client";
import { AnthropicVisionClient, DEFAULT_VISION_MODEL } from "@/vision/client";
import { DEFAULT_MAX_IMAGES, runVision, formatVisionSummary } from "@/vision/vision";

/**
 * Optional AI vision CLI (uses the Claude API with vision — costs money).
 * Analyzes each listing's photos into searchable visual features so the UI can
 * do natural-language visual search ("hardwood floors and bay windows").
 *
 *   npm run vision -- --dry-run              show what would be analyzed, no API calls
 *   npm run vision -- --limit 20             analyze up to 20 new/changed listings
 *   npm run vision -- --source-listing <id>  analyze one listing by id
 *   npm run vision -- --max-images 4         send at most 4 photos per listing
 *   npm run vision -- --cost-cap 1.00        stop before ~$1.00 of spend
 *   npm run vision -- --force                re-analyze even if photos unchanged
 *   npm run vision -- --all                  no per-run limit (analyze every eligible listing)
 *
 * Model: $APT_VISION_MODEL (default claude-haiku-4-5 — cheap and capable for
 * bounded visual extraction). Requires ANTHROPIC_API_KEY (or an `ant auth login`
 * profile). This is the backfill path; a future managed agent can call the same
 * runVision() per new listing it picks up.
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
  const maxImages = numFlag(args, "--max-images") ?? DEFAULT_MAX_IMAGES;

  const model = process.env.APT_VISION_MODEL ?? DEFAULT_VISION_MODEL;

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "No ANTHROPIC_API_KEY found.\n" +
        "Vision analysis uses the Claude API. Set a key and re-run:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  npm run vision -- --limit 10\n" +
        "(Or run `ant auth login` if you use the Anthropic CLI.)\n" +
        "Use `npm run vision -- --dry-run` to preview what would be analyzed without a key.",
    );
    process.exit(1);
  }

  const db = createDb();
  const client = new AnthropicVisionClient({ model });
  const log = (m: string) => console.log(m);

  if (!dryRun) {
    console.log(
      `Analyzing photos with ${model}` +
        (limit != null ? ` (up to ${limit} listings` : " (all eligible listings") +
        `, ≤${maxImages} images each` +
        (costCapUsd != null ? `, cost cap $${costCapUsd}` : "") +
        `)…`,
    );
  }

  const summary = await runVision(db, client, {
    listingId,
    limit,
    costCapUsd,
    force,
    dryRun,
    includeInactive,
    maxImages,
    log,
  });
  console.log("\n" + formatVisionSummary(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
