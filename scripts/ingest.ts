import { createDb } from "@/db/client";
import {
  formatSummaryLine,
  runAllEnabled,
  runSource,
  type RunSummary,
} from "@/ingest/runner";

/**
 * Ingestion CLI.
 *
 *   npm run ingest -- --all                 run every enabled source
 *   npm run ingest -- --source craigslist_sf
 *   npm run ingest -- --source mosser_living (explicit id runs even if disabled)
 *   flags: --no-geocode  disable network geocoding (neighborhood fallback still applies)
 */

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const noGeocode = args.includes("--no-geocode");
  const sourceIdx = args.indexOf("--source");
  const sourceId = sourceIdx >= 0 ? args[sourceIdx + 1] : null;

  if (!all && !sourceId) {
    console.log("usage: npm run ingest -- --all | --source <id> [--no-geocode]");
    process.exit(1);
  }

  const db = await createDb();
  const log = (m: string) => console.log(`  ${m}`);
  const opts = { geocode: !noGeocode, log };

  let summaries: RunSummary[];
  if (all) {
    summaries = await runAllEnabled(db, opts);
  } else {
    // Running a source by explicit id is operator intent — allow disabled.
    summaries = [await runSource(db, sourceId!, { ...opts, force: true })];
  }

  console.log(`\nRan ${summaries.length} source${summaries.length === 1 ? "" : "s"}:`);
  for (const s of summaries) console.log(formatSummaryLine(s));

  const failed = summaries.filter((s) => s.status === "failed").length;
  const attempted = summaries.filter((s) => s.status !== "skipped").length;
  if (attempted > 0 && failed === attempted) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
