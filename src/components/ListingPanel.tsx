"use client";

import { useEffect, useRef, useState } from "react";
import type { ListingSummary } from "@/lib/api-types";
import type { MatchInfo, SortKey } from "./AppShell";
import {
  EMPTY_PROGRESS,
  SearchProgress,
  type SearchProgressState,
} from "./SearchProgress";
import {
  fmtBaths,
  fmtBeds,
  fmtMoney,
  PRECISION_LABELS,
  realAddress,
} from "@/lib/format";
import { CompactBadge } from "./Badges";
import { PhotoImg } from "./PhotoImg";

/** Shared readout so the panel header and the mobile drawer handle agree. */
export function listingCountLabel({
  count,
  searching,
  loading,
  searchActive,
  hoodName,
}: {
  count: number;
  searching?: boolean;
  loading?: boolean;
  searchActive?: boolean;
  hoodName?: string | null;
}): { n: string; unit: string; scope: string | null } {
  if (searching) return { n: "", unit: "Searching…", scope: hoodName ?? null };
  if (loading) return { n: "", unit: "Loading…", scope: null };
  const unit = searchActive
    ? count === 1 ? "match" : "matches"
    : count === 1 ? "listing" : "listings";
  return { n: String(count), unit, scope: hoodName ?? null };
}

export function ListingPanel({
  listings,
  reasons,
  searchActive,
  searching,
  loading,
  progress,
  interpretation,
  hoodName,
  selectedId,
  onSelect,
  sort,
  onSortChange,
  hideSuspicious,
  onToggleSuspicious,
  onSaveSearch,
  searchSaved,
  chromeless,
  hideHeader,
}: {
  listings: ListingSummary[];
  reasons?: Map<string, MatchInfo>;
  searchActive?: boolean;
  searching?: boolean;
  /** The initial /api/listings fetch hasn't resolved yet — show a loading
   * state instead of the "no listings" empty state, which would otherwise
   * be indistinguishable from a genuinely empty result. */
  loading?: boolean;
  progress?: SearchProgressState;
  /** the model's one-line restatement of what the search asked for */
  interpretation?: string | null;
  hoodName?: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  hideSuspicious?: boolean;
  onToggleSuspicious?: () => void;
  /** open the "save & watch this search" dialog (desktop rail only) */
  onSaveSearch?: () => void;
  searchSaved?: boolean;
  /** Drawer mode: drop the panel's own border/rounding/shadow. */
  chromeless?: boolean;
  /** Drawer mode: the handle supplies the count + sort, so skip the header. */
  hideHeader?: boolean;
}) {
  const label = listingCountLabel({
    count: listings.length,
    searching,
    searchActive,
    hoodName,
  });

  return (
    <aside
      className={
        chromeless
          ? "flex h-full w-full flex-col overflow-hidden"
          : "textured flex h-full w-full flex-col overflow-hidden rounded-xl border-2 border-white/30 bg-panel/98 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),-14px_0_50px_-8px_rgba(0,0,0,0.9),0_28px_70px_-12px_rgba(0,0,0,0.92)] backdrop-blur-xl"
      }
    >
      {/* While searching, the thinking feed owns the panel — no duplicate
          "Searching…" header, no dead sort dropdown. */}
      {!hideHeader && !searching && (
        <div
          className="animate-fade-in relative flex items-center justify-between gap-2 border-b border-line px-3 py-2.5"
          style={{ zIndex: 40 }}
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            {label.n && (
              <span className="tnum text-[15px] leading-none font-semibold text-ink">
                {label.n}
              </span>
            )}
            <span className="text-[13px] text-muted">{label.unit}</span>
            {label.scope && (
              <span className="truncate text-[13px] text-accent">· {label.scope}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onToggleSuspicious && (
              <SuspiciousToggle hideSuspicious={hideSuspicious} onToggle={onToggleSuspicious} />
            )}
            <SortSelect sort={sort} searchActive={searchActive} onSortChange={onSortChange} />
          </div>
        </div>
      )}

      {/* How the model read the ask + a way to hand it to the overnight Scout. */}
      {!hideHeader && !searching && searchActive && (interpretation || onSaveSearch) && (
        <div className="animate-fade-in flex items-start gap-2 border-b border-line/70 bg-accent/10 px-3 py-2">
          {interpretation ? (
            <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-muted" title={interpretation}>
              {interpretation}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          {onSaveSearch && (
            <button
              type="button"
              onClick={onSaveSearch}
              disabled={searchSaved}
              title={searchSaved ? "Porter is watching this search" : "Save & put this search on Porter"}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors ${
                searchSaved
                  ? "border-good/40 bg-good/10 text-good"
                  : "border-accent/45 bg-accent/10 text-accent hover:bg-accent/15"
              }`}
            >
              {searchSaved ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Watching
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 3h14a1 1 0 0 1 1 1v16l-8-5-8 5V4a1 1 0 0 1 1-1Z" />
                  </svg>
                  Save search
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <SearchProgress progress={progress ?? EMPTY_PROGRESS} />
        ) : loading ? (
          <LoadingState />
        ) : listings.length === 0 ? (
          <EmptyState searchActive={searchActive} hoodName={hoodName} />
        ) : (
          <ul className="flex flex-col">
            {listings.map((l, i) => (
              <ListingCard
                key={l.id}
                listing={l}
                match={reasons?.get(l.id)}
                animateIn={searchActive}
                index={i}
                selected={l.id === selectedId}
                onSelect={() => onSelect(l.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Icon toggle to hide verify-carefully / suspicious listings. */
export function SuspiciousToggle({
  hideSuspicious,
  onToggle,
}: {
  hideSuspicious?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={hideSuspicious}
      aria-label={hideSuspicious ? "Show suspicious listings" : "Hide suspicious listings"}
      className={`flex h-[26px] w-[26px] items-center justify-center rounded-md border transition-colors ${
        hideSuspicious
          ? "border-warn/45 bg-warn/12 text-warn"
          : "border-line text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10.3 5.2a11 11 0 0 1 1.7-.2c6 0 9 6 9 7a12.6 12.6 0 0 1-2 2.7M6.6 6.6C3.7 8.3 2 11.4 2 12c0 1 3 7 10 7 2 0 3.7-.5 5.1-1.3M3 3l18 18" />
      </svg>
    </button>
  );
}

/** Icon entry to Porter / watched searches, with a new-match count. */
/** Compact icon-only variant — for chrome that's already tight on space
 * (kept for any future embedded use; the app's main entry point is now
 * PorterFab, floating outside the panel entirely — see AppShell). */
export function PorterButton({ badge, onClick }: { badge?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Porter — watched searches & applications"
      title="Porter"
      className="relative flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      <BellIcon size={15} />
      {!!badge && badge > 0 && (
        <span className="absolute -top-2.5 -right-2.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-paper tabular-nums shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
          {badge > 99 ? "99" : badge}
        </span>
      )}
    </button>
  );
}

/** Porter's own entry point — pulled OUT of the results panel/drawer entirely
 * (see AppShell) and placed inline next to the search bar, so it stays
 * visible and reachable regardless of panel/drawer state on any screen size.
 * A fixed h-12/w-12 circle (see the className note) — bigger and more visually
 * weighted than a chrome icon: this is Porter's front door, not a utility
 * toggle. */
const WIGGLE_DELAY_MS = 500; // beat after the count arrives before the bell moves
const WIGGLE_DURATION_MS = 700; // matches @keyframes bell-wiggle (0.7s)

export function PorterFab({
  badge,
  onClick,
  className = "",
}: {
  badge?: number;
  onClick: () => void;
  className?: string;
}) {
  // First time a real count arrives (badge 0 → n, right after the
  // saved-searches fetch resolves once the listings are up): hold a beat, then
  // wiggle the bell to draw the eye, and only reveal the badge AFTER the wiggle
  // finishes — the motion leads, the number lands second, instead of both
  // appearing at once.
  const [wiggling, setWiggling] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const startedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  // Kick the intro off exactly once, the first time a real count arrives
  // (badge 0 → n, right after the saved-searches fetch resolves once the
  // listings are up): hold WIGGLE_DELAY_MS, wiggle the bell, then flip introDone
  // so the badge pops in only after the wiggle. All state changes happen in the
  // timer callbacks, so the effect body itself never setState-cascades.
  useEffect(() => {
    if ((badge ?? 0) <= 0 || startedRef.current) return;
    startedRef.current = true;
    timersRef.current.push(
      window.setTimeout(() => setWiggling(true), WIGGLE_DELAY_MS),
      window.setTimeout(() => {
        setWiggling(false);
        setIntroDone(true);
      }, WIGGLE_DELAY_MS + WIGGLE_DURATION_MS),
    );
  }, [badge]);
  // Clear pending timers only on unmount — a mid-intro count change must NOT
  // abort the sequence (that would leave the badge hidden forever).
  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  // The badge only shows once the wiggle intro has finished.
  const badgeShown = introDone && !!badge && badge > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Porter — watched searches & applications"
      title="Porter"
      // Fixed h-12/w-12 (not aspect-square + stretch): the header row uses
      // items-stretch, so when the search bar wraps to two lines a stretchable
      // Porter would grow into a tall oval — an explicit width AND height keeps
      // it a perfect circle regardless of the row height.
      className={`textured group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-white/30 bg-panel/98 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_18px_45px_-8px_rgba(0,0,0,0.9),0_5px_16px_-3px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-colors hover:bg-elevated ${className}`}
    >
      <BellIcon size={20} className={wiggling ? "animate-bell-wiggle" : undefined} />
      {badgeShown && !!badge && badge > 0 && (
        // Badge sits proud of the top-right corner (not tucked into the rim)
        // and is deliberately large so a real count reads at a glance, while
        // the bell stays centered in the circle. A ring in the button's own
        // surface color carves a clean gap between the chip and the icon.
        // It only mounts once badgeShown flips true (after the wiggle), so the
        // one-shot animate-badge-pop plays exactly when the number lands.
        // NOTE: position/zIndex are set inline, not via `absolute`/`z-10`,
        // because `.textured > *` is UNLAYERED CSS that would otherwise force
        // this child back to position:relative — which would drop it into the
        // flex flow and shove the bell off-center. Inline styles outrank it.
        <span
          style={{ position: "absolute", zIndex: 2 }}
          className="animate-badge-pop -top-2.5 -right-2.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] leading-none font-bold text-paper tabular-nums ring-2 ring-panel shadow-[0_2px_8px_rgba(0,0,0,0.7)]"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/** Concierge / desk bell — Porter's mark. */
export function BellIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M3.5 18.5h17" />
      <path d="M5.5 18.5a6.5 6.5 0 0 1 13 0" />
      <path d="M12 8.5v3.5" />
      <circle cx="12" cy="7" r="1.6" />
    </svg>
  );
}

export function SortSelect({
  sort,
  searchActive,
  onSortChange,
}: {
  sort: SortKey;
  searchActive?: boolean;
  onSortChange: (s: SortKey) => void;
}) {
  return (
    <select
      value={sort}
      onChange={(e) => onSortChange(e.target.value as SortKey)}
      aria-label="Sort listings"
      className="shrink-0 rounded border border-line bg-elevated px-1.5 py-1 text-[12px] text-muted outline-none focus:border-line-strong"
    >
      <option value="newest">{searchActive ? "Best match" : "Newest"}</option>
      <option value="price_asc">Price: low</option>
      <option value="price_desc">Price: high</option>
    </select>
  );
}

function EmptyState({
  searchActive,
  hoodName,
}: {
  searchActive?: boolean;
  hoodName?: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-[14px] font-medium text-muted">
        {searchActive ? "No matches" : hoodName ? "No listings here" : "No listings in view"}
      </p>
      <p className="max-w-[16rem] text-[12.5px] leading-relaxed text-faint">
        {searchActive
          ? "Try rephrasing, widening the radius, or showing hidden listings."
          : hoodName
            ? "Nothing active in this neighborhood right now."
            : "Pan or zoom the map, or run a search."}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading listings">
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
        <span className="text-[13px] font-medium text-ink">Loading listings…</span>
      </div>
      <ul className="flex flex-col">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex gap-3 border-b border-line px-3 py-3">
            <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-elevated" />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
              <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-elevated" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-elevated" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small ring for the 0–100 AI match score, softly toned by quality
 * (muted green → amber → red; desaturated so it reads as a hint, never glows). */
function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone =
    pct >= 80 ? "var(--color-good)" : pct >= 62 ? "var(--color-warn)" : "var(--color-alert)";
  return (
    <span
      className="relative flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(color-mix(in srgb, ${tone} 44%, var(--color-line)) ${pct * 3.6}deg, var(--color-line) 0deg)`,
      }}
      title={`Match score: ${Math.round(pct)}/100`}
    >
      <span
        className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-surface text-[9px] font-semibold tabular-nums"
        style={{ color: `color-mix(in srgb, ${tone} 55%, var(--color-muted))` }}
      >
        {Math.round(pct)}
      </span>
    </span>
  );
}

function ListingCard({
  listing: l,
  match,
  animateIn,
  index,
  selected,
  onSelect,
}: {
  listing: ListingSummary;
  match?: MatchInfo;
  animateIn?: boolean;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);

  const price = l.priceEffectiveMonthly ?? l.priceMonthly;
  const hasConcession =
    l.priceEffectiveMonthly != null &&
    l.priceMonthly != null &&
    l.priceEffectiveMonthly < l.priceMonthly;
  const dimmed = l.userStatus === "hidden" || l.userStatus === "not_a_fit";
  const location =
    [realAddress(l.addressRaw), l.neighborhood ?? l.sourceNeighborhoodRaw]
      .filter(Boolean)
      .join(" · ") || PRECISION_LABELS[l.geocodePrecision];
  const specs = [fmtBeds(l.bedrooms), fmtBaths(l.bathrooms)];
  if (l.squareFeet) specs.push(`${l.squareFeet.toLocaleString()} sqft`);

  return (
    <li
      ref={ref}
      className={animateIn ? "animate-fade-up" : undefined}
      style={animateIn ? { animationDelay: `${Math.min(index, 10) * 40}ms` } : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`group flex w-full flex-col gap-2 border-b border-line/70 px-3 py-2.5 text-left transition-colors ${
          selected ? "bg-accent/20" : "hover:bg-white/[0.06]"
        } ${dimmed ? "opacity-55" : ""}`}
      >
        <div className="flex w-full gap-3">
          <PhotoImg
            src={l.primaryPhotoUrl}
            alt={l.title}
            className="h-[76px] w-[100px] shrink-0 rounded-md object-cover"
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[16px] leading-none font-semibold text-ink tabular-nums">
                {fmtMoney(price)}
              </span>
              <span className="text-[12px] text-faint">/mo</span>
              {hasConcession && (
                <span
                  className="text-[11px] font-medium text-good"
                  title={`Effective with concessions (advertised ${fmtMoney(l.priceMonthly)})`}
                >
                  effective
                </span>
              )}
              {l.lastPriceChange && l.lastPriceChange.newPrice < l.lastPriceChange.oldPrice && (
                <span className="text-[11.5px] text-faint line-through tabular-nums">
                  {fmtMoney(l.lastPriceChange.oldPrice)}
                </span>
              )}
              <CompactBadge badges={l.badges} />
              {match && (
                <span className="ml-auto">
                  <ScoreGauge score={match.score} />
                </span>
              )}
            </div>

            <p className="mt-0.5 truncate text-[13px] leading-snug text-ink" title={l.title}>
              {l.title}
            </p>
            <p className="truncate text-[12.5px] text-muted">{specs.join(" · ")}</p>
            <p className="truncate text-[12px] text-faint" title={location}>
              {location}
            </p>
          </div>
        </div>

        {/* AI fit — full width under the thumbnail; expands on hover to read it all */}
        {match && (
          <div className="w-full overflow-hidden rounded-md bg-accent/12 transition-[max-height] duration-300 ease-out max-h-[40px] group-hover:max-h-32">
            <p className="px-2 py-1 text-[11px] leading-snug text-accent">{match.reason}</p>
          </div>
        )}
      </button>
    </li>
  );
}
