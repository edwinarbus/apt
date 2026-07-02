import { createDb } from "@/db/client";
import { formatSummaryLine, runAllEnabled } from "@/ingest/runner";
import { computeDigest, formatDigestConsole } from "@/ingest/digest";

/**
 * The scheduled daily loop: ingest every enabled source, then compute the
 * saved-search digest. This is the single entry point a cron/launchd job runs.
 * It is intentionally conservative (the underlying runner already caps request
 * volume, respects robots.txt, and never marks listings missing after a
 * failed/partial run) and it never contacts anyone — the digest is a local
 * report.
 *
 *   npm run daily
 *   npm run daily -- --no-geocode
 */

async function main() {
  const args = process.argv.slice(2);
  const noGeocode = args.includes("--no-geocode");
  const db = createDb();
  const log = (m: string) => console.log(`  ${m}`);

  console.log(`[${new Date().toISOString()}] daily run: ingesting enabled sources…`);
  const summaries = await runAllEnabled(db, { geocode: !noGeocode, log });
  for (const s of summaries) console.log(formatSummaryLine(s));

  console.log(`\n[${new Date().toISOString()}] computing saved-search digest…`);
  const digest = computeDigest(db, { dryRun: false });
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
