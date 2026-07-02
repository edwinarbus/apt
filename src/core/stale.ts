import type { RunStatus, StaleStatus } from "./types";

/**
 * Cautious stale-listing lifecycle. A listing is only advanced along the
 * missing chain after a run that (a) succeeded and (b) completed pagination —
 * a failed or partial crawl proves nothing about listing availability.
 *
 *   active -> missing_once -> missing_multiple_runs -> likely_unavailable
 *
 * A listing seen again at any point snaps back to "active" (with a
 * "reappeared" event recorded by the runner).
 */

const MISSING_CHAIN: StaleStatus[] = [
  "missing_once",
  "missing_multiple_runs",
  "likely_unavailable",
];

export function advanceStaleStatus(current: StaleStatus): StaleStatus {
  if (current === "active" || current === "still_seen" || current === "unknown") {
    return "missing_once";
  }
  const idx = MISSING_CHAIN.indexOf(current);
  if (idx === -1) return current; // source_failed_do_not_update etc: leave alone
  return MISSING_CHAIN[Math.min(idx + 1, MISSING_CHAIN.length - 1)];
}

export function isMissingStatus(status: StaleStatus): boolean {
  return MISSING_CHAIN.includes(status);
}

/**
 * Gate for missing-listing processing: only trust a fully successful run.
 * `paginationCompleted === null` (unknown) also blocks stale updates — if we
 * cannot prove we saw every listing, we must not punish the ones we missed.
 */
export function shouldProcessStaleUpdates(
  runStatus: RunStatus,
  paginationCompleted: boolean | null,
): boolean {
  return runStatus === "success" && paginationCompleted === true;
}
