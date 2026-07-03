"use client";

import { useEffect, useMemo, useState } from "react";
import type { ListingSummary, SavedSearchDto } from "@/lib/api-types";
import { fmtBaths, fmtBeds, fmtMoney, relativeTime } from "@/lib/format";
import { PhotoImg } from "./PhotoImg";

/**
 * The in-app face of the overnight "Apt Scout" managed agent: the searches it
 * watches (with optional auto-apply drafts), what it picked up on the last run,
 * its cadence, and what it does (rank + draft, never send). Reads from listings
 * already in memory plus the saved-search API, so it works with or without the
 * cloud agent deployed.
 */
export function ScoutPanel({
  listings,
  onClose,
  onSelect,
}: {
  listings: ListingSummary[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [searches, setSearches] = useState<SavedSearchDto[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    fetch("/api/searches")
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((d: { searches: SavedSearchDto[] }) => live && setSearches(d.searches))
      .catch(() => live && setSearches([]));
    return () => {
      live = false;
    };
  }, []);

  const fresh = useMemo(
    () =>
      listings.filter(
        (l) =>
          l.listingStatus === "active" &&
          l.staleStatus !== "likely_unavailable" &&
          l.badges.includes("new_today"),
      ),
    [listings],
  );
  const picks = useMemo(
    () => [...fresh].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1)).slice(0, 6),
    [fresh],
  );
  const lastRunAt = useMemo(
    () =>
      listings.reduce<string | null>(
        (acc, l) => (l.sourceLastRunAt && (!acc || l.sourceLastRunAt > acc) ? l.sourceLastRunAt : acc),
        null,
      ),
    [listings],
  );

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-rise-in flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line bg-gradient-to-b from-accent-soft/40 to-transparent px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink">Apt Scout</h2>
            <p className="text-[12.5px] text-muted">
              Overnight rental scout · runs nightly at 3:00 AM
              {lastRunAt && <> · last checked {relativeTime(lastRunAt)}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Watched searches */}
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Watched searches</h3>
            {searches && searches.length > 0 && (
              <span className="text-[12px] text-faint">
                {searches.length} watching
              </span>
            )}
          </div>

          {searches === null ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] text-faint">
              Loading…
            </p>
          ) : searches.length === 0 ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] leading-relaxed text-faint">
              Run a search, then hit <span className="font-medium text-muted">Save search</span> to have
              Scout watch it every night — and optionally auto-draft applications for new matches.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {searches.map((s) => (
                <WatchedSearch key={s.id} search={s} onSelect={onSelect} onClose={onClose} />
              ))}
            </ul>
          )}

          {/* Overnight pickups */}
          <div className="mt-6 mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Picked up overnight</h3>
            <span className="text-[12px] text-faint">
              {fresh.length} new {fresh.length === 1 ? "listing" : "listings"}
            </span>
          </div>

          {picks.length === 0 ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] text-faint">
              Nothing new since the last run. The scout checks every enabled source each night.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {picks.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(l.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg border border-line bg-elevated/30 p-2 text-left transition-colors hover:border-line-strong hover:bg-elevated/60"
                  >
                    <PhotoImg
                      src={l.primaryPhotoUrl}
                      alt=""
                      className="h-12 w-16 shrink-0 rounded-md object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[14px] font-semibold text-ink tabular-nums">
                          {fmtMoney(l.priceEffectiveMonthly ?? l.priceMonthly)}
                        </span>
                        <span className="text-[11px] text-faint">/mo</span>
                        <span className="truncate text-[12px] text-muted">
                          {[fmtBeds(l.bedrooms), fmtBaths(l.bathrooms)].join(" · ")}
                        </span>
                      </div>
                      <p className="truncate text-[12px] text-faint">
                        {[l.addressRaw, l.neighborhood ?? l.sourceNeighborhoodRaw].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-faint">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* What it does */}
          <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">How it works</h3>
          <ul className="flex flex-col gap-2.5">
            {[
              ["Scans every night", "Pulls new listings from all enabled sources, then enriches and photo-analyzes them."],
              ["Ranks against your searches", "Scores what's new against every watched search and writes a short why for each keeper."],
              ["Drafts, never sends", "For auto-apply searches it stages a ready-to-send application — you review and send it."],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <p className="text-[12.5px] leading-relaxed text-muted">
                  <span className="font-medium text-ink">{title}.</span> {body}
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-4 rounded-lg border border-line bg-elevated/30 px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
            Runs locally on the nightly pipeline, or in the cloud via Claude Managed Agents
            (<code className="rounded-sm border border-line bg-elevated px-1 py-0.5 text-[10.5px] text-muted">npm run scout:deploy</code>).
            It never contacts anyone — every application is a draft for you to send.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One watched search: stats, auto-apply state, and (if armed) the drafted application. */
function WatchedSearch({
  search: s,
  onSelect,
  onClose,
}: {
  search: SavedSearchDto;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [showDraft, setShowDraft] = useState(false);
  return (
    <li className="rounded-lg border border-line bg-elevated/30 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink" title={s.name}>
            {s.name}
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">
            <span className="text-muted tabular-nums">{s.matchCount}</span> match{s.matchCount === 1 ? "" : "es"}
            {s.newMatchCount > 0 && (
              <span className="text-good"> · {s.newMatchCount} new</span>
            )}
          </p>
        </div>
        {s.autoApply ? (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
            </svg>
            Auto-apply
          </span>
        ) : (
          <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
            Watching
          </span>
        )}
      </div>

      {s.autoApply && s.sampleDraft && (
        <div className="mt-2 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setShowDraft((v) => !v)}
            className="flex w-full items-center gap-1 text-[11.5px] font-medium text-accent transition-colors hover:text-accent-deep"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={`transition-transform ${showDraft ? "rotate-90" : ""}`} aria-hidden>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {showDraft ? "Hide" : "Preview"} the application Scout drafted
          </button>

          {showDraft && (
            <div className="mt-2 rounded-md border border-line bg-paper/50 p-2.5">
              <button
                type="button"
                onClick={() => {
                  if (s.sampleDraft) onSelect(s.sampleDraft.listingId);
                  onClose();
                }}
                className="mb-1.5 block truncate text-left text-[12px] font-medium text-accent hover:underline"
                title={s.sampleDraft.listingTitle ?? undefined}
              >
                {s.sampleDraft.listingTitle ?? "Listing"} ↗
              </button>
              <p className="text-[11px] text-faint">
                <span className="text-muted">To:</span>{" "}
                {s.sampleDraft.to ?? "— (no public contact; apply via the listing)"}
              </p>
              <p className="text-[11px] text-faint">
                <span className="text-muted">Subject:</span> {s.sampleDraft.subject}
              </p>
              <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-muted">
                {s.sampleDraft.body}
              </pre>
              <p className="mt-2 flex items-center gap-1.5 rounded-sm bg-warn/10 px-2 py-1 text-[10.5px] text-warn">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                Draft only — Scout never sends. Review and send it yourself.
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
