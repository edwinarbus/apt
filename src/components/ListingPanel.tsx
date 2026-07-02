"use client";

import { useEffect, useRef } from "react";
import type { ListingSummary } from "@/lib/api-types";
import type { MatchInfo, SortKey } from "./AppShell";
import {
  fmtBaths,
  fmtBeds,
  fmtMoney,
  PRECISION_LABELS,
  relativeTime,
} from "@/lib/format";
import { BadgeRow } from "./Badges";
import { PhotoImg } from "./PhotoImg";

export function ListingPanel({
  listings,
  reasons,
  searchActive,
  selectedId,
  onSelect,
  sort,
  onSortChange,
}: {
  listings: ListingSummary[];
  reasons?: Map<string, MatchInfo>;
  searchActive?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-paper xl:w-[440px]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <span className="text-sm font-semibold">
            {listings.length} {searchActive ? "match" : "listing"}
            {listings.length === 1 ? "" : searchActive ? "es" : "s"}
          </span>
          <p className="text-[11px] text-faint">
            {searchActive
              ? "Ranked by AI · verify details with the source before acting."
              : "Verify availability & terms with the source before acting."}
          </p>
        </div>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted outline-none"
        >
          <option value="newest">{searchActive ? "Best match" : "Newest first"}</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {listings.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-faint">
            {searchActive
              ? "No listings matched your search. Try rephrasing, widening the radius, or “Show hidden & gone”."
              : "Nothing matches the current view."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {listings.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                match={reasons?.get(l.id)}
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

function ListingCard({
  listing: l,
  match,
  selected,
  onSelect,
}: {
  listing: ListingSummary;
  match?: MatchInfo;
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

  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={onSelect}
        className={`group flex w-full gap-3 rounded-xl border bg-surface p-2.5 text-left shadow-sm transition-all hover:shadow-md ${
          selected ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-faint"
        } ${dimmed ? "opacity-55" : ""}`}
      >
        <PhotoImg
          src={l.primaryPhotoUrl}
          alt={l.title}
          className="h-[92px] w-[118px] shrink-0 rounded-lg object-cover"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[17px] font-semibold tracking-tight">
              {fmtMoney(price)}
            </span>
            <span className="text-[11px] text-faint">/mo</span>
            {hasConcession && (
              <span
                className="text-[10px] font-medium text-good"
                title={`Effective with concessions (advertised ${fmtMoney(l.priceMonthly)})`}
              >
                effective
              </span>
            )}
            {l.lastPriceChange && l.lastPriceChange.newPrice < l.lastPriceChange.oldPrice && (
              <span className="text-[10px] text-faint line-through">
                {fmtMoney(l.lastPriceChange.oldPrice)}
              </span>
            )}
            {match && (
              <span
                className="ml-auto rounded-full bg-accent-soft/60 px-1.5 py-0.5 text-[10px] font-semibold text-accent-deep"
                title="AI match score"
              >
                {Math.round(match.score)}
              </span>
            )}
          </div>
          <p className="truncate text-[13px] leading-snug font-medium text-ink" title={l.title}>
            {l.title}
          </p>
          <p className="truncate text-[12px] text-muted">
            {fmtBeds(l.bedrooms)} · {fmtBaths(l.bathrooms)}
            {l.squareFeet ? ` · ${l.squareFeet.toLocaleString()} sqft` : ""} · {location}
          </p>
          {match ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-accent-deep/90">
              ✦ {match.reason}
            </p>
          ) : (
            <div className="mt-1">
              <BadgeRow badges={l.badges} max={3} />
            </div>
          )}
          <p className="mt-auto pt-1 text-[11px] text-faint">
            {l.sourceName} · checked {relativeTime(l.lastSeenAt)}
          </p>
        </div>
      </button>
    </li>
  );
}
