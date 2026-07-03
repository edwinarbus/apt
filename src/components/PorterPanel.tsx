"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApplicationDraftDto, ListingSummary, SavedSearchDto } from "@/lib/api-types";
import { fmtMoney, relativeTime } from "@/lib/format";
import { PhotoImg } from "./PhotoImg";
import { BellIcon } from "./ListingPanel";

/**
 * Porter — the managed agent's surface, framed as an activity report: overnight
 * it reviews new listings for the user's watched searches and writes a
 * ready-to-send email to each matching property. This panel shows what Porter
 * did (the prepared emails, one tap to send) and lets the user manage the
 * searches it watches.
 */
function mailtoHref(a: ApplicationDraftDto): string | null {
  if (!a.to || a.channel !== "email") return null;
  return `mailto:${a.to}?subject=${encodeURIComponent(a.subject)}&body=${encodeURIComponent(a.body)}`;
}

export function PorterPanel({
  listings,
  onClose,
  onSelect,
  onChanged,
}: {
  listings: ListingSummary[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onChanged?: () => void;
}) {
  const [searches, setSearches] = useState<SavedSearchDto[] | null>(null);
  const [closing, setClosing] = useState(false);

  // Auto-send: when on, Porter sends each email itself the moment it finds a
  // match, so the drafts below read as already sent. Persisted across opens.
  const [autoSend, setAutoSend] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("apt.porterAutoSend") === "1";
    } catch {
      return false;
    }
  });
  const toggleAutoSend = useCallback(() => {
    setAutoSend((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("apt.porterAutoSend", next ? "1" : "0");
      } catch {
        /* best effort */
      }
      return next;
    });
  }, []);

  // Play a scale-down before unmounting so close is animated too.
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 150);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

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
  const newTotal = useMemo(
    () => (searches ?? []).reduce((n, s) => n + s.newMatchCount, 0),
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

  const unfollow = async (id: string) => {
    setSearches((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    try {
      await fetch(`/api/searches/${id}`, { method: "DELETE" });
    } catch {
      /* best effort */
    }
    onChanged?.();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] ${
        closing ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
      onClick={requestClose}
    >
      <div
        className={`flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.6)] ${
          closing ? "animate-modal-out" : "animate-modal-in"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-start gap-3 overflow-hidden border-b border-line px-5 py-4">
          <div className="pointer-events-none absolute -top-14 -right-8 h-36 w-36 rounded-full bg-accent/12 blur-3xl" />
          <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BellIcon size={20} />
          </span>
          <div className="relative min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink">Porter</h2>
            <p className="text-[12.5px] text-muted">
              Your overnight rental agent
              {lastRunAt && <> · last ran {relativeTime(lastRunAt)}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Activity report — what Porter did while you were away */}
          {searches && searches.length > 0 && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-accent/25 bg-accent/10 px-3.5 py-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                <BellIcon size={13} />
              </span>
              <p className="text-[12.5px] leading-relaxed text-muted">
                <span className="font-medium text-ink">While you were away,</span> Porter checked your{" "}
                {searches.length} watched {searches.length === 1 ? "search" : "searches"}, found{" "}
                <span className="font-semibold text-ink">{newTotal}</span> new{" "}
                {newTotal === 1 ? "match" : "matches"}
                {applications.length > 0 ? (
                  autoSend ? (
                    <>
                      , and sent{" "}
                      <span className="font-semibold text-ink">{applications.length}</span>{" "}
                      {applications.length === 1 ? "email" : "emails"} to the properties on your behalf.
                    </>
                  ) : (
                    <>
                      , and wrote{" "}
                      <span className="font-semibold text-ink">{applications.length}</span>{" "}
                      {applications.length === 1 ? "email" : "emails"} to the properties — ready to send below.
                    </>
                  )
                ) : (
                  <>.</>
                )}
              </p>
            </div>
          )}

          {/* Auto-send — Porter sends each email itself, no tap needed */}
          {applications.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-elevated/25 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">Auto-send</p>
                <p className="text-[11.5px] leading-snug text-faint">
                  Porter sends each email itself the moment it finds a match.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSend}
                aria-label="Auto-send emails"
                onClick={toggleAutoSend}
                className={`relative flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                  autoSend ? "bg-accent" : "bg-line-strong"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    autoSend ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}

          {/* Emails Porter drafted (or sent, when auto-send is on) */}
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">
              {autoSend ? "Emails Porter sent" : "Emails Porter drafted"}
            </h3>
            {applications.length > 0 && (
              <span className="text-[12px] text-faint">
                {applications.length} {autoSend ? "sent" : "ready"}
              </span>
            )}
          </div>

          {searches === null ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] text-faint">
              Loading…
            </p>
          ) : applications.length === 0 ? (
            <p className="rounded-lg border border-line bg-elevated/40 px-3 py-5 text-center text-[12.5px] leading-relaxed text-faint">
              Turn on <span className="font-medium text-muted">Auto-apply</span> when you save a
              search, and Porter will email each matching property for you — every draft shows up
              here to send in one tap.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {applications.map((a) => (
                <ApplicationCard
                  key={a.listingId}
                  app={a}
                  sent={autoSend}
                  onSelect={onSelect}
                  onClose={requestClose}
                />
              ))}
            </ul>
          )}

          {/* Watched searches — with unfollow */}
          {searches && searches.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">Watched searches</h3>
              <ul className="flex flex-col gap-1.5">
                {searches.map((s) => (
                  <li
                    key={s.id}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-line bg-elevated/25 px-3 py-2"
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      {s.autoApply ? (
                        <span className="flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
                          </svg>
                          Auto-apply
                        </span>
                      ) : (
                        <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
                          Watching
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => unfollow(s.id)}
                        aria-label={`Unfollow ${s.name}`}
                        title="Unfollow"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-alert/15 hover:text-alert"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
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
              ["Emails properties for you", "Writes a tailored email — with your details — to every new match on your auto-apply searches."],
              autoSend
                ? ["Sends automatically", "With auto-send on, Porter sends each email itself — they show up here already sent."]
                : ["You send in one tap", "Every email is queued here — review it and send it from your inbox in a tap."],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <p className="text-[12.5px] leading-relaxed text-muted">
                  <span className="font-medium text-ink">{title}.</span> {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One email Porter drafted: the property + a one-tap "Email property", expandable to preview.
 *  When `sent` (auto-send is on), it reads as already sent instead of offering the button. */
function ApplicationCard({
  app: a,
  sent,
  onSelect,
  onClose,
}: {
  app: ApplicationDraftDto;
  sent: boolean;
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
            <p className="truncate text-[11.5px] text-faint">
              {a.to ? (
                <>
                  {sent ? "Sent" : "Email drafted"} to {a.to}
                </>
              ) : (
                a.addressLine
              )}
            </p>
          </div>
        </button>
        {sent && a.to ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-good/40 bg-good/10 px-2.5 py-1.5 text-[12.5px] font-semibold text-good">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Sent
          </span>
        ) : href ? (
          <a
            href={href}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-paper transition-colors hover:bg-accent-deep"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6.5 12 13l9-6.5" /><rect x="3" y="5" width="18" height="14" rx="2" />
            </svg>
            Email property
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
        {open ? "Hide" : "Review"} the email
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
          <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-muted">
            {a.body}
          </pre>
        </div>
      )}
    </li>
  );
}
