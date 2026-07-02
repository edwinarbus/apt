"use client";

import { useEffect, useState } from "react";
import type {
  SourceDashboardEntry,
  SourceRunPayload,
  SourcesResponse,
} from "@/lib/api-types";
import { fmtDateShort, relativeTime } from "@/lib/format";

const RUN_COLORS: Record<string, string> = {
  success: "#1E7F4F",
  partial: "#B45309",
  failed: "#C2410C",
  skipped: "#A39B8B",
};

function StatusDot({ status }: { status: string | null }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: status ? (RUN_COLORS[status] ?? "#A39B8B") : "#D8D2C6" }}
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
    good: "bg-good/10 text-good",
    warn: "bg-warn/10 text-warn",
    muted: "bg-line/50 text-muted",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[tone]}`}>
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
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Sources
            </h1>
            <p className="mt-1 text-sm text-muted">
              {enabled.length} of {sources.length} sources enabled
              {lastRunAt ? ` · last ingest ${relativeTime(lastRunAt)}` : " · never ingested"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[12.5px] text-muted">
            Run ingestion from the CLI:{" "}
            <code className="rounded bg-line/60 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
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
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusDot status={run?.status ?? null} />
        <h2 className="text-[15px] font-semibold">{s.name}</h2>
        <span className="rounded-full bg-line/50 px-2 py-0.5 font-mono text-[11px] text-muted">
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
        </span>
      </div>

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
        <div className="mt-3 rounded-xl bg-paper/70 px-4 py-3 text-[12.5px]">
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
