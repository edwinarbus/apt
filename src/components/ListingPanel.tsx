"use client";

import { useEffect, useRef } from "react";
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
} from "@/lib/format";
import { CompactBadge } from "./Badges";
import { PhotoImg } from "./PhotoImg";

/** Shared readout so the panel header and the mobile drawer handle agree. */
export function listingCountLabel({
  count,
  searching,
  searchActive,
  hoodName,
}: {
  count: number;
  searching?: boolean;
  searchActive?: boolean;
  hoodName?: string | null;
}): { n: string; unit: string; scope: string | null } {
  if (searching) return { n: "", unit: "Searching…", scope: hoodName ?? null };
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
  progress,
  hoodName,
  selectedId,
  onSelect,
  sort,
  onSortChange,
  hideSuspicious,
  onToggleSuspicious,
  chromeless,
  hideHeader,
}: {
  listings: ListingSummary[];
  reasons?: Map<string, MatchInfo>;
  searchActive?: boolean;
  searching?: boolean;
  progress?: SearchProgressState;
  hoodName?: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  hideSuspicious?: boolean;
  onToggleSuspicious?: () => void;
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
          : "flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface/97 shadow-[0_12px_44px_rgba(0,0,0,0.5)]"
      }
    >
      {/* While searching, the thinking feed owns the panel — no duplicate
          "Searching…" header, no dead sort dropdown. */}
      {!hideHeader && !searching && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
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
              <button
                type="button"
                onClick={onToggleSuspicious}
                aria-pressed={hideSuspicious}
                title={hideSuspicious ? "Showing all listings" : "Hide verify-carefully / suspicious listings"}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors ${
                  hideSuspicious
                    ? "border-warn/40 bg-warn/10 text-warn"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10.3 5.2a11 11 0 0 1 1.7-.2c6 0 9 6 9 7a12.6 12.6 0 0 1-2 2.7M6.6 6.6C3.7 8.3 2 11.4 2 12c0 1 3 7 10 7 2 0 3.7-.5 5.1-1.3M3 3l18 18" />
                </svg>
                {hideSuspicious ? "Suspicious hidden" : "Hide suspicious"}
              </button>
            )}
            <SortSelect sort={sort} searchActive={searchActive} onSortChange={onSortChange} />
          </div>
        </div>
      )}

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <SearchProgress progress={progress ?? EMPTY_PROGRESS} />
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

/** Compact ring for the 0–100 AI match score, toned by how good the match is
 * (muted green → amber → red; mixed down so it never glows). */
function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone =
    pct >= 80 ? "var(--color-good)" : pct >= 65 ? "var(--color-warn)" : "var(--color-alert)";
  return (
    <span
      className="relative flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(color-mix(in srgb, ${tone} 62%, transparent) ${pct * 3.6}deg, var(--color-line) 0deg)`,
      }}
      title={`Match score: ${Math.round(pct)}/100`}
    >
      <span
        className="flex h-[19px] w-[19px] items-center justify-center rounded-full bg-surface text-[9.5px] font-semibold tabular-nums"
        style={{ color: `color-mix(in srgb, ${tone} 76%, var(--color-muted))` }}
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
    [l.addressRaw, l.neighborhood ?? l.sourceNeighborhoodRaw]
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
        className={`group relative flex w-full gap-3 border-b border-line px-3 py-2.5 text-left transition-colors ${
          selected ? "bg-accent-soft/50" : "hover:bg-elevated/60"
        } ${dimmed ? "opacity-55" : ""}`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-[3px] ${selected ? "bg-accent" : "bg-transparent"}`}
          aria-hidden
        />
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

          {match && (
            <p className="mt-1.5 line-clamp-2 rounded-md bg-accent-soft/60 px-2 py-1 text-[12px] leading-snug text-accent">
              {match.reason}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}
