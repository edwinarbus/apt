"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BadgeKind, ListingSummary, ListingsResponse } from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import { matchesVisualQuery } from "@/lib/visual-search";
import type { UserListingStatus } from "@/core/types";
import { FilterBar, type Filters, DEFAULT_FILTERS } from "./FilterBar";
import { MapView } from "./MapView";
import { ListingPanel } from "./ListingPanel";
import { ListingDetail } from "./ListingDetail";

export type SortKey = "newest" | "price_asc" | "price_desc";

export function AppShell() {
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json() as Promise<ListingsResponse>;
      })
      .then((data) => setListings(data.listings))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!listings) return [];
    const q = filters.query.trim().toLowerCase();
    const result = listings.filter((l) => {
      if (!filters.showHidden && (l.userStatus === "hidden" || l.userStatus === "not_a_fit")) {
        return false;
      }
      if (
        !filters.showUnavailable &&
        (l.staleStatus === "likely_unavailable" || l.listingStatus !== "active")
      ) {
        return false;
      }
      const price = l.priceEffectiveMonthly ?? l.priceMonthly;
      if (filters.minPrice != null && (price == null || price < filters.minPrice)) return false;
      if (filters.maxPrice != null && (price == null || price > filters.maxPrice)) return false;
      if (filters.minBeds != null && (l.bedrooms == null || l.bedrooms < filters.minBeds)) {
        return false;
      }
      if (filters.dogs && l.dogsAllowed !== true) return false;
      if (filters.cats && l.catsAllowed !== true) return false;
      if (filters.laundry !== "any") {
        if (filters.laundry === "in_unit" && l.laundryNormalized !== "in_unit") return false;
        if (
          filters.laundry === "any_laundry" &&
          l.laundryNormalized !== "in_unit" &&
          l.laundryNormalized !== "in_building"
        ) {
          return false;
        }
      }
      if (filters.neighborhoods.length > 0) {
        if (!l.neighborhood || !filters.neighborhoods.includes(l.neighborhood)) return false;
      }
      if (filters.verifyOnly && l.scamRiskLevel === "none") return false;
      if (q) {
        const hay = `${l.title} ${l.neighborhood ?? ""} ${l.addressRaw ?? ""} ${l.sourceName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.visualQuery.trim() && !matchesVisualQuery(l.visualSearchText, filters.visualQuery)) {
        return false;
      }
      return true;
    });
    const price = (l: ListingSummary) =>
      l.priceEffectiveMonthly ?? l.priceMonthly ?? Number.MAX_SAFE_INTEGER;
    if (sort === "price_asc") result.sort((a, b) => price(a) - price(b));
    else if (sort === "price_desc") result.sort((a, b) => price(b) - price(a));
    else result.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
    return result;
  }, [listings, filters, sort]);

  const neighborhoods = useMemo(() => {
    const set = new Set<string>();
    for (const l of listings ?? []) if (l.neighborhood) set.add(l.neighborhood);
    return [...set].sort();
  }, [listings]);

  const select = useCallback((id: string | null, openDetail = true) => {
    setSelectedId(id);
    if (id && openDetail) setDetailOpen(true);
  }, []);

  const handleStatusChange = useCallback(
    (listingId: string, status: UserListingStatus | null) => {
      setListings((prev) =>
        prev
          ? prev.map((l) => {
              if (l.id !== listingId) return l;
              const badges: BadgeKind[] = computeBadges({
                firstSeenAt: l.firstSeenAt,
                staleStatus: l.staleStatus,
                scamRiskLevel: l.scamRiskLevel,
                duplicateGroupId: l.duplicateGroupId,
                userStatus: status,
                lastPriceChange: l.lastPriceChange,
                sourceLastRunStatus: l.sourceLastRunStatus,
              });
              return { ...l, userStatus: status, badges };
            })
          : prev,
      );
    },
    [],
  );

  const selected = filtered.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        neighborhoods={neighborhoods}
        shownCount={filtered.length}
        totalCount={listings?.length ?? 0}
        loading={listings === null && !error}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <MapView
            listings={filtered}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
          />
          {error && (
            <Overlay>
              <p className="font-medium text-alert">Could not load listings</p>
              <p className="mt-1 text-sm text-muted">{error}</p>
            </Overlay>
          )}
          {listings !== null && listings.length === 0 && (
            <Overlay>
              <p className="font-display text-lg font-semibold">No listings yet</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                Seed demo data with <Code>npm run seed:mock</Code> or ingest real
                SF sources with <Code>npm run ingest -- --all</Code>, then reload.
              </p>
            </Overlay>
          )}
        </div>
        <ListingPanel
          listings={filtered}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          sort={sort}
          onSortChange={setSort}
        />
      </div>
      {detailOpen && selected && (
        <ListingDetail
          key={selected.id}
          listingId={selected.id}
          onClose={() => setDetailOpen(false)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-paper/60 backdrop-blur-sm">
      <div className="rounded-2xl border border-line bg-surface px-8 py-6 text-center shadow-lg">
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-line/60 px-1.5 py-0.5 font-mono text-[12px] text-ink">
      {children}
    </code>
  );
}
