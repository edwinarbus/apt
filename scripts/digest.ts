import { createDb } from "@/db/client";
import { computeDigest, formatDigestConsole } from "@/ingest/digest";

/**
 * Saved-search digest CLI.
 *
 *   npm run digest              compute the digest, mark matches notified, write a report
 *   npm run digest -- --dry-run preview without marking anything notified (repeatable)
 *   npm run digest -- --json    machine-readable output
 *
 * The digest never contacts anyone — it prepares a local report you read.
 */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");

  const db = await createDb();
  const result = await computeDigest(db, { dryRun });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDigestConsole(result));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
