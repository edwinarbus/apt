"use client";

import { useEffect, useState } from "react";
import type {
  SourceDashboardEntry,
  SourceRunPayload,
  SourcesResponse,
} from "@/lib/api-types";
import { fmtDateShort, relativeTime } from "@/lib/format";

// Tactical status palette (kept in sync with globals.css tokens).
const RUN_COLORS: Record<string, string> = {
  success: "#35c489", // good
  partial: "#e6a54a", // warn
  failed: "#e8564d", // alert
  skipped: "#6a7688", // stale
};

const OVERALL_STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  PASS: { bg: "#35c48916", fg: "#35c489" },
  PARTIAL: { bg: "#e6a54a16", fg: "#e6a54a" },
  FAIL: { bg: "#e8564d16", fg: "#e8564d" },
  SKIPPED: { bg: "#6a768822", fg: "#94a2b6" },
  DISABLED: { bg: "#6a768822", fg: "#94a2b6" },
  REFERENCE_ONLY: { bg: "#47aede16", fg: "#47aede" },
  NEEDS_REVIEW: { bg: "#b96fd816", fg: "#b96fd8" },
};

function OverallStatusChip({ status }: { status: string }) {
  const style = OVERALL_STATUS_STYLES[status] ?? OVERALL_STATUS_STYLES.SKIPPED;
  return (
    <span
      className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]"
      style={{ backgroundColor: style.bg, borderColor: `${style.fg}40`, color: style.fg }}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-[1px]"
      style={{ backgroundColor: status ? (RUN_COLORS[status] ?? "#6a7688") : "#2c3848" }}
      title={status ?? "never run"}
    />
  );
}

function Flag({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "muted";
}) {
  const colors = {
    good: "border-good/35 bg-good/10 text-good",
    warn: "border-warn/35 bg-warn/10 text-warn",
    muted: "border-line bg-elevated text-muted",
  };
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.03em] ${colors[tone]}`}
    >
      {label}
    </span>
  );
}

export function SourcesDashboard() {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json() as Promise<SourcesResponse>;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const sources = data?.sources ?? [];
  const enabled = sources.filter((s) => s.enabled);
  const lastRunAt = sources
    .map((s) => s.lastRun?.startedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="panel-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Sources</h1>
              <span className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
                diagnostics
              </span>
            </div>
            <p className="mt-1 font-mono text-[11.5px] tracking-[0.02em] text-muted tabular-nums">
              {enabled.length}/{sources.length} enabled
              {lastRunAt ? ` · last ingest ${relativeTime(lastRunAt)}` : " · never ingested"}
            </p>
          </div>
          <div className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11.5px] text-muted">
            ingest:{" "}
            <code className="rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-[11px] text-ink">
              npm run ingest -- --all
            </code>
          </div>
        </div>

        {error && <p className="mt-8 text-alert">{error}</p>}
        {!data && !error && <p className="mt-8 text-sm text-faint">Loading…</p>}

        <div className="mt-6 flex flex-col gap-4">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source: s }: { source: SourceDashboardEntry }) {
  const [showRuns, setShowRuns] = useState(false);
  const run = s.lastRun;

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-[0_2px_10px_rgba(0,0,0,0.3)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusDot status={run?.status ?? null} />
        <h2 className="text-[15px] font-semibold text-ink">{s.name}</h2>
        <OverallStatusChip status={s.overallStatus} />
        <span className="rounded-sm border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted">
          {s.id}
        </span>
        <Flag label={s.sourceSystem} tone="muted" />
        <Flag label={s.priority} tone="muted" />
        {s.enabled ? (
          <Flag label="enabled" tone="good" />
        ) : (
          <Flag label="disabled" tone="muted" />
        )}
        <span className="ml-auto text-[12px] text-faint">
          {s.activeListings} active / {s.totalListings} total listings
          {s.listingCountTrend != null && s.listingCountTrend !== 0 && (
            <span
              className={s.listingCountTrend > 0 ? "text-good" : "text-warn"}
              title="listings found vs previous run"
            >
              {" "}
              {s.listingCountTrend > 0 ? "▲" : "▼"}
              {Math.abs(s.listingCountTrend)}
            </span>
          )}
        </span>
      </div>
      {(s.lastVerificationStatus || s.lastSuccessfulRunAt) && (
        <p className="mt-1.5 text-[12px] text-faint">
          {s.lastVerificationStatus && (
            <>
              Adapter verification: {s.lastVerificationStatus}
              {s.lastVerificationAt && ` (${relativeTime(s.lastVerificationAt)})`}
            </>
          )}
          {s.lastVerificationStatus && s.lastSuccessfulRunAt && " · "}
          {s.lastSuccessfulRunAt && (
            <>last successful run {relativeTime(s.lastSuccessfulRunAt)}</>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Flag
          label={`robots: ${s.robotsStatus.replaceAll("_", " ")}`}
          tone={
            s.robotsStatus === "allowed" || s.robotsStatus === "no_robots_txt"
              ? "good"
              : s.robotsStatus === "not_checked"
                ? "muted"
                : "warn"
          }
        />
        <Flag
          label={`permission: ${s.permissionStatus.replaceAll("_", " ")}`}
          tone={s.permissionStatus === "ok_personal_low_frequency" ? "good" : "warn"}
        />
        {s.needsJavaScript && <Flag label="needs JS" tone="warn" />}
        {s.blocksAutomation && <Flag label="blocks automation" tone="warn" />}
        {s.safeForPersonalLowFrequencyFetching === true && (
          <Flag label="safe for low-frequency personal use" tone="good" />
        )}
        <Flag label={`adapter: ${s.adapterType}`} tone="muted" />
        {s.crawlIntervalHours > 0 && (
          <Flag label={`every ${s.crawlIntervalHours}h`} tone="muted" />
        )}
      </div>

      {run ? (
        <div className="mt-3 rounded-md border border-line bg-paper/60 px-3.5 py-3 font-mono text-[12px] tabular-nums">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium" style={{ color: RUN_COLORS[run.status] }}>
              Last run: {run.status}
            </span>
            <span className="text-muted">{relativeTime(run.startedAt)}</span>
            <span className="text-muted">
              {run.listingsFound} found · {run.newListings} new · {run.changedListings}{" "}
              changed
              {run.priceChangedListings > 0 && ` · ${run.priceChangedListings} price Δ`}
              {run.missingListings > 0 && ` · ${run.missingListings} newly missing`}
              {run.suspectedDuplicates > 0 && ` · ${run.suspectedDuplicates} dupes`}
              {run.suspectedScams > 0 && ` · ${run.suspectedScams} verify`}
            </span>
            <span className="text-faint">
              {run.pagesVisited} pages / {run.detailPagesVisited} detail
              {run.totalListingsReportedBySource != null &&
                ` · source reports ${run.totalListingsReportedBySource}`}
            </span>
            <span
              className={
                run.paginationCompleted === true
                  ? "text-good"
                  : run.paginationCompleted === false
                    ? "text-alert"
                    : "text-warn"
              }
            >
              pagination{" "}
              {run.paginationCompleted === true
                ? "✓ complete"
                : run.paginationCompleted === false
                  ? "✗ incomplete"
                  : "? unknown"}
            </span>
            <span className={run.staleProcessed ? "text-good" : "text-faint"}>
              missing-tracking {run.staleProcessed ? "✓ ran" : "not run"}
            </span>
          </div>
          {run.errorMessage && (
            <p className="mt-1.5 text-alert">error: {run.errorMessage.split("\n")[0]}</p>
          )}
          {run.warnings.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-warn">
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-faint">Never run.</p>
      )}

      {s.sourceStatusNotes && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{s.sourceStatusNotes}</p>
      )}
      {s.notes && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">{s.notes}</p>
      )}

      <div className="mt-3 flex items-center gap-4 text-[12.5px]">
        {s.listingUrl && (
          <a
            href={s.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent hover:underline"
          >
            Listing page ↗
          </a>
        )}
        {s.websiteUrl && s.websiteUrl !== s.listingUrl && (
          <a
            href={s.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-ink hover:underline"
          >
            Website ↗
          </a>
        )}
        {s.recentRuns.length > 1 && (
          <button
            type="button"
            onClick={() => setShowRuns(!showRuns)}
            className="ml-auto text-muted hover:text-ink"
          >
            {showRuns ? "Hide run history" : `Run history (${s.recentRuns.length})`}
          </button>
        )}
      </div>

      {showRuns && (
        <table className="mt-3 w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-faint">
              <th className="py-1.5 pr-3 font-medium">When</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Found</th>
              <th className="py-1.5 pr-3 font-medium">New</th>
              <th className="py-1.5 pr-3 font-medium">Changed</th>
              <th className="py-1.5 pr-3 font-medium">Missing</th>
              <th className="py-1.5 pr-3 font-medium">Pages</th>
              <th className="py-1.5 font-medium">Pagination</th>
            </tr>
          </thead>
          <tbody>
            {s.recentRuns.map((r: SourceRunPayload) => (
              <tr key={r.id} className="border-b border-line/60 text-muted">
                <td className="py-1.5 pr-3" title={r.startedAt}>
                  {fmtDateShort(r.startedAt)} · {relativeTime(r.startedAt)}
                </td>
                <td className="py-1.5 pr-3">
                  <span style={{ color: RUN_COLORS[r.status] }}>{r.status}</span>
                </td>
                <td className="py-1.5 pr-3">{r.listingsFound}</td>
                <td className="py-1.5 pr-3">{r.newListings}</td>
                <td className="py-1.5 pr-3">{r.changedListings}</td>
                <td className="py-1.5 pr-3">{r.missingListings}</td>
                <td className="py-1.5 pr-3">
                  {r.pagesVisited}/{r.detailPagesVisited}d
                </td>
                <td className="py-1.5">
                  {r.paginationCompleted === true
                    ? "✓"
                    : r.paginationCompleted === false
                      ? "✗"
                      : "?"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
