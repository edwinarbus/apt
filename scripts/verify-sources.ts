import { createDb } from "@/db/client";
import { sources } from "@/db/schema";
import {
  formatVerificationReport,
  verifySource,
  type VerificationReport,
} from "@/ingest/verify";

/**
 * Adapter verification CLI.
 *
 *   npm run sources:verify                       fixture mode, all sources (offline)
 *   npm run sources:verify -- --source <id>      one source (runs even if disabled)
 *   npm run sources:verify -- --enabled-only     only enabled sources
 *   npm run sources:verify -- --live             fetch the real sources (no listing writes)
 *   npm run sources:verify -- --dry-run          offline + do not persist verification status
 *   npm run sources:verify -- --json             machine-readable output
 *
 * Verification never writes listings. By default the PASS/PARTIAL/FAIL/SKIPPED
 * outcome is stored on the source row (shown on the dashboard); --dry-run or
 * --no-save suppresses that too.
 */

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const enabledOnly = args.includes("--enabled-only");
  const noSave = args.includes("--no-save") || dryRun;
  const sourceIdx = args.indexOf("--source");
  const sourceId = sourceIdx >= 0 ? args[sourceIdx + 1] : null;

  const mode: "live" | "fixture" = live && !dryRun ? "live" : "fixture";
  const db = await createDb();
  const log = json ? () => {} : (m: string) => console.log(`  ${m}`);

  const all = await db.select().from(sources).all();
  const targets = sourceId
    ? all.filter((s) => s.id === sourceId)
    : enabledOnly
      ? all.filter((s) => s.enabled)
      : all;
  if (sourceId && targets.length === 0) {
    console.error(`unknown source: ${sourceId}`);
    process.exit(1);
  }

  const reports: VerificationReport[] = [];
  for (const s of targets) {
    reports.push(
      await verifySource(db, s.id, {
        mode,
        save: !noSave,
        force: sourceId != null, // explicit id = operator intent
        log,
      }),
    );
  }

  if (json) {
    console.log(JSON.stringify({ mode, dryRun, reports }, null, 2));
  } else {
    console.log(`\nAdapter verification complete (${mode} mode${dryRun ? ", dry run" : ""}):\n`);
    for (const r of reports) {
      console.log(formatVerificationReport(r));
      console.log();
    }
    const counts = { PASS: 0, PARTIAL: 0, FAIL: 0, SKIPPED: 0 };
    for (const r of reports) counts[r.status]++;
    console.log(
      `Summary: ${counts.PASS} PASS, ${counts.PARTIAL} PARTIAL, ${counts.FAIL} FAIL, ${counts.SKIPPED} SKIPPED`,
    );
  }

  if (reports.some((r) => r.status === "FAIL")) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
