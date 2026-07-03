"use client";

import { useEffect, useMemo } from "react";
import type { ListingSummary, SavedSearchDto } from "@/lib/api-types";
import { fmtBaths, fmtBeds, fmtMoney } from "@/lib/format";
import { PhotoImg } from "./PhotoImg";

/**
 * First-open "while you were away" surface: what the overnight Apt Scout turned
 * up for the user's saved searches since they last looked. Purely a summary of
 * already-ingested listings — it opens once per session when there's something
 * new to show.
 */
export function WelcomeBackModal({
  searches,
  listings,
  onSelect,
  onOpenScout,
  onClose,
}: {
  searches: SavedSearchDto[];
  listings: ListingSummary[];
  onSelect: (id: string) => void;
  onOpenScout: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const groups = useMemo(
    () =>
      searches
        .filter((s) => s.newMatchCount > 0)
        .map((s) => ({
          search: s,
          items: s.newMatchIds
            .map((id) => byId.get(id))
            .filter((l): l is ListingSummary => !!l)
            .slice(0, 3),
        }))
        .filter((g) => g.items.length > 0)
        .slice(0, 3),
    [searches, byId],
  );
  const total = groups.reduce((n, g) => n + g.search.newMatchCount, 0);
  const autoApplying = groups.some((g) => g.search.autoApply);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="animate-rise-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-strong/60 bg-surface shadow-[0_28px_80px_rgba(0,0,0,0.65)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-line px-5 py-4">
          <div className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-accent/12 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4l1.4-1.4m10-10 1.4-1.4" />
                <circle cx="12" cy="12" r="3.2" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-ink">While you were away</h2>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">
                Apt Scout found <span className="font-semibold text-ink">{total}</span> new{" "}
                {total === 1 ? "match" : "matches"} across your saved searches
                {autoApplying && <>, with applications drafted</>}.
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
        </div>

        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groups.map((g) => (
            <div key={g.search.id} className="mb-3 last:mb-0">
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <p className="truncate text-[12px] font-medium text-muted" title={g.search.name}>
                  {g.search.name}
                </p>
                <span className="shrink-0 text-[11.5px] text-good">
                  {g.search.newMatchCount} new
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(l.id);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg border border-line bg-elevated/30 p-2 text-left transition-colors hover:border-line-strong hover:bg-elevated/60"
                    >
                      <PhotoImg src={l.primaryPhotoUrl} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
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
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[11.5px] text-faint">Scout runs nightly · never contacts anyone</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenScout();
                onClose();
              }}
              className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-accent-deep"
            >
              Review in Scout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
