"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApplicationDraftDto, ListingSummary, SavedSearchDto } from "@/lib/api-types";
import { fmtMoney, relativeTime } from "@/lib/format";
import { PhotoImg } from "./PhotoImg";

/**
 * Porter — the managed agent's surface. Its core job is auto-applying:
 * every night it reviews new listings for the user's watched searches and
 * writes a ready-to-send application for each match. This panel foregrounds
 * those applications (one tap sends from the user's email) and lists the
 * searches Porter watches.
 */
function mailtoHref(a: ApplicationDraftDto): string | null {
  if (!a.to || a.channel !== "email") return null;
  return `mailto:${a.to}?subject=${encodeURIComponent(a.subject)}&body=${encodeURIComponent(a.body)}`;
}

export function PorterPanel({
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

  const applications = useMemo(
    () => (searches ?? []).flatMap((s) => s.applications),
    [searches],
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
      className="animate-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-modal-in flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-start gap-3 overflow-hidden border-b border-line px-5 py-4">
          <div className="pointer-events-none absolute -top-14 -right-8 h-36 w-36 rounded-full bg-accent/12 blur-3xl" />
          <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 2c3 2.5 4.5 6 4.5 10 0 2.2-.8 4.2-2 5.8L12 22l-2.5-4.2c-1.2-1.6-2-3.6-2-5.8C7.5 8 9 4.5 12 2Z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
          </span>
          <div className="relative min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink">Porter</h2>
            <p className="text-[12.5px] text-muted">
              Applies to new matches for you · runs nightly
              {lastRunAt && <> · last run {relativeTime(lastRunAt)}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Ready to send — the core auto-apply surface */}
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Applications ready to send</h3>
            {applications.length > 0 && (
              <span className="text-[12px] text-faint">{applications.length} prepared</span>
            )}
          </div>

          {searches === null ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] text-faint">
              Loading…
            </p>
          ) : applications.length === 0 ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] leading-relaxed text-faint">
              Turn on <span className="font-medium text-muted">Auto-apply</span> when you save a
              search, and Porter will write an application for every new match — ready here to
              send in one tap.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applications.map((a) => (
                <ApplicationCard key={a.listingId} app={a} onSelect={onSelect} onClose={onClose} />
              ))}
            </ul>
          )}

          {/* Watched searches */}
          {searches && searches.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">Watched searches</h3>
              <ul className="flex flex-col gap-1.5">
                {searches.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevated/25 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink" title={s.name}>
                        {s.name}
                      </p>
                      <p className="text-[11.5px] text-faint">
                        <span className="text-muted tabular-nums">{s.matchCount}</span> match
                        {s.matchCount === 1 ? "" : "es"}
                        {s.newMatchCount > 0 && <span className="text-good"> · {s.newMatchCount} new</span>}
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
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* How it works */}
          <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">How Porter works</h3>
          <ul className="flex flex-col gap-2.5">
            {[
              ["Scans every night", "Pulls new listings from all your sources, then enriches and photo-analyzes them."],
              ["Applies for you", "Writes a tailored application for every new match on your auto-apply searches."],
              ["You send in one tap", "Every application is queued here — review it and send it from your email in a tap."],
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
            (<code className="rounded-sm border border-line bg-elevated px-1 py-0.5 text-[10.5px] text-muted">npm run porter:deploy</code>).
          </p>
        </div>
      </div>
    </div>
  );
}

/** One prepared application: the listing + a one-tap Send, expandable to preview. */
function ApplicationCard({
  app: a,
  onSelect,
  onClose,
}: {
  app: ApplicationDraftDto;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const href = mailtoHref(a);
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-elevated/30">
      <div className="flex items-center gap-3 p-2">
        <button
          type="button"
          onClick={() => {
            onSelect(a.listingId);
            onClose();
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <PhotoImg src={a.primaryPhotoUrl} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[14px] font-semibold text-ink tabular-nums">
                {fmtMoney(a.priceMonthly)}
              </span>
              <span className="truncate text-[12px] text-muted">{a.listingTitle}</span>
            </div>
            <p className="truncate text-[12px] text-faint">{a.addressLine}</p>
          </div>
        </button>
        {href ? (
          <a
            href={href}
            className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-paper transition-colors hover:bg-accent-deep"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
            </svg>
            Send
          </a>
        ) : (
          <span className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[11.5px] text-faint">
            Apply on site
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-line px-3 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:text-accent-deep"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {open ? "Hide" : "Review"} the application
      </button>
      {open && (
        <div className="border-t border-line bg-paper/40 p-2.5">
          <p className="text-[11px] text-faint">
            <span className="text-muted">To:</span>{" "}
            {a.to ?? "— (no public email; apply via the listing)"}
          </p>
          <p className="text-[11px] text-faint">
            <span className="text-muted">Subject:</span> {a.subject}
          </p>
          <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-muted">
            {a.body}
          </pre>
        </div>
      )}
    </li>
  );
}
