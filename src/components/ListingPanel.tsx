"use client";

import { useEffect, useRef } from "react";
import type { ListingSummary } from "@/lib/api-types";
import type { MatchInfo, SortKey } from "./AppShell";
import { SearchProgress, type SearchProgressState } from "./SearchProgress";
import {
  fmtBaths,
  fmtBeds,
  fmtMoney,
  PRECISION_LABELS,
  relativeTime,
} from "@/lib/format";
import { BadgeRow } from "./Badges";
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
  if (searching) return { n: "—", unit: "SCANNING", scope: hoodName ?? null };
  const unit = searchActive
    ? count === 1
      ? "MATCH"
      : "MATCHES"
    : count === 1
      ? "LISTING"
      : "LISTINGS";
  return { n: String(count), unit, scope: hoodName ?? null };
}

export function ListingPanel({
  listings,
  reasons,
  searchActive,
  searching,
  progress,
  hasLocation,
  hoodName,
  selectedId,
  onSelect,
  sort,
  onSortChange,
  chromeless,
  hideHeader,
}: {
  listings: ListingSummary[];
  reasons?: Map<string, MatchInfo>;
  searchActive?: boolean;
  searching?: boolean;
  progress?: SearchProgressState;
  hasLocation?: boolean;
  hoodName?: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
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
          : "flex h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-surface/96 shadow-[0_12px_44px_rgba(0,0,0,0.5)]"
      }
    >
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-1.5 font-mono">
            <span className="tnum text-[15px] leading-none font-semibold text-ink">
              {label.n}
            </span>
            <span className="text-[10px] tracking-[0.14em] text-muted">{label.unit}</span>
            {label.scope && (
              <span className="truncate text-[10px] tracking-[0.08em] text-accent">
                · {label.scope.toUpperCase()}
              </span>
            )}
          </div>
          <SortSelect sort={sort} searchActive={searchActive} onSortChange={onSortChange} />
        </div>
      )}

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <SearchProgress
            progress={
              progress ?? { candidates: null, kept: null, keptIds: null, model: null, chars: 0 }
            }
            hasLocation={!!hasLocation}
          />
        ) : listings.length === 0 ? (
          <EmptyState searchActive={searchActive} hoodName={hoodName} />
        ) : (
          <ul className="flex flex-col gap-1.5 p-2">
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
      className="shrink-0 rounded-sm border border-line bg-elevated px-1.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-muted outline-none focus:border-line-strong"
    >
      <option value="newest">{searchActive ? "Best match" : "Newest"}</option>
      <option value="price_asc">Price ↑</option>
      <option value="price_desc">Price ↓</option>
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
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      {/* Quiet empty-scope reticle — no result signal, calmly stated. */}
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden className="text-line-strong">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <p className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
        {searchActive ? "No matches" : hoodName ? "Sector empty" : "No listings in view"}
      </p>
      <p className="max-w-[15rem] text-[11.5px] leading-relaxed text-faint">
        {searchActive
          ? "Rephrase, widen the radius, or enable Hidden+Gone."
          : hoodName
            ? "Nothing active in this neighborhood right now."
            : "Pan or zoom the map, or run a search."}
      </p>
    </div>
  );
}

/** Compact conic gauge for the 0–100 AI match score — instrumentation, not confetti. */
function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(var(--color-accent) ${pct * 3.6}deg, var(--color-line) 0deg)`,
      }}
      title={`AI match score: ${Math.round(pct)}/100`}
    >
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-elevated font-mono text-[10.5px] font-semibold text-accent tabular-nums">
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
  if (l.squareFeet) specs.push(`${l.squareFeet.toLocaleString()} SF`);
  const approximate =
    l.geocodePrecision === "neighborhood" || l.geocodePrecision === "city";

  return (
    <li
      ref={ref}
      className={animateIn ? "animate-fade-up" : undefined}
      style={animateIn ? { animationDelay: `${Math.min(index, 10) * 45}ms` } : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`group relative flex w-full gap-2.5 overflow-hidden rounded-md border p-2 text-left transition-colors duration-150 ${
          selected
            ? "border-accent bg-accent-soft/40"
            : "border-line bg-elevated/50 hover:border-line-strong hover:bg-elevated"
        } ${dimmed ? "opacity-55" : ""}`}
      >
        {/* Selection rail */}
        <span
          className={`absolute inset-y-0 left-0 w-[2px] transition-colors ${
            selected ? "bg-accent" : "bg-transparent"
          }`}
          aria-hidden
        />
        <div className="relative shrink-0 overflow-hidden rounded-[3px] border border-line-strong">
          <PhotoImg
            src={l.primaryPhotoUrl}
            alt={l.title}
            className="h-[82px] w-[104px] object-cover"
          />
          {approximate && (
            <span
              className="absolute right-1 bottom-1 rounded-[2px] bg-paper/80 px-1 font-mono text-[8px] tracking-[0.08em] text-muted"
              title="Neighborhood-level (approximate) location"
            >
              APPROX
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[15px] leading-none font-semibold tracking-tight text-ink tabular-nums">
              {fmtMoney(price)}
            </span>
            <span className="font-mono text-[9.5px] text-faint">/MO</span>
            {hasConcession && (
              <span
                className="font-mono text-[9px] tracking-[0.06em] text-good uppercase"
                title={`Effective with concessions (advertised ${fmtMoney(l.priceMonthly)})`}
              >
                eff
              </span>
            )}
            {l.lastPriceChange && l.lastPriceChange.newPrice < l.lastPriceChange.oldPrice && (
              <span className="font-mono text-[9.5px] text-faint line-through tabular-nums">
                {fmtMoney(l.lastPriceChange.oldPrice)}
              </span>
            )}
            {match && (
              <span className="ml-auto">
                <ScoreGauge score={match.score} />
              </span>
            )}
          </div>

          <p className="truncate text-[12.5px] leading-snug font-medium text-ink" title={l.title}>
            {l.title}
          </p>
          <p className="truncate font-mono text-[10px] tracking-[0.02em] text-muted">
            {specs.join("  ·  ")}
          </p>
          <p className="truncate text-[11px] text-faint" title={location}>
            {location}
          </p>

          {match ? (
            <p className="mt-1 line-clamp-2 border-l-2 border-accent/50 bg-accent-soft/35 py-1 pr-1 pl-2 text-[11px] leading-snug text-accent">
              <span className="font-mono text-[8.5px] tracking-[0.14em] text-accent/70">
                MATCH{" "}
              </span>
              {match.reason}
            </p>
          ) : (
            l.badges.length > 0 && (
              <div className="mt-1">
                <BadgeRow badges={l.badges} max={3} />
              </div>
            )
          )}

          <p className="mt-1 flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.04em] text-faint">
            <span className="truncate uppercase">{l.sourceName}</span>
            <span aria-hidden className="text-line-strong">·</span>
            <span className="shrink-0 tabular-nums">{relativeTime(l.lastSeenAt)}</span>
          </p>
        </div>
      </button>
    </li>
  );
}
