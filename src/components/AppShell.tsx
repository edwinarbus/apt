"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BadgeKind,
  ListingSummary,
  ListingsResponse,
  SearchResponse,
} from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import type { UserListingStatus } from "@/core/types";
import { SearchBar, type LocationStatus } from "./SearchBar";
import { MapView } from "./MapView";
import { ListingPanel } from "./ListingPanel";
import { ListingDetail } from "./ListingDetail";

export type SortKey = "newest" | "price_asc" | "price_desc";
export interface MatchInfo {
  score: number;
  reason: string;
}

export function AppShell() {
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Search state
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showHiddenGone, setShowHiddenGone] = useState(false);

  // Location state
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [radiusMi, setRadiusMi] = useState(10);

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json() as Promise<ListingsResponse>;
      })
      .then((data) => setListings(data.listings))
      .catch((e) => setError(e.message));
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  // Ask for location on load (default radius 10mi); the user can also trigger it.
  useEffect(() => {
    // Requesting geolocation is a genuine mount side effect, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    requestLocation();
  }, [requestLocation]);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setSearch(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          location: locationStatus === "granted" ? location : null,
          radiusMi: locationStatus === "granted" ? radiusMi : null,
          includeHiddenGone: showHiddenGone,
        }),
      });
      const data = (await res.json()) as SearchResponse;
      if (data.error) {
        setSearchError(data.error);
        setSearch(null);
      } else {
        setSearch(data);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setSearch(null);
    } finally {
      setSearching(false);
    }
  }, [query, location, locationStatus, radiusMi, showHiddenGone]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setSearch(null);
    setSearchError(null);
  }, []);

  const reasonById = useMemo(() => {
    const m = new Map<string, MatchInfo>();
    if (search) for (const mt of search.matches) m.set(mt.id, { score: mt.score, reason: mt.reason });
    return m;
  }, [search]);

  const displayed = useMemo(() => {
    if (!listings) return [];
    const price = (l: ListingSummary) =>
      l.priceEffectiveMonthly ?? l.priceMonthly ?? Number.MAX_SAFE_INTEGER;

    let result: ListingSummary[];
    if (search) {
      const byId = new Map(listings.map((l) => [l.id, l]));
      result = search.matches
        .map((mt) => byId.get(mt.id))
        .filter((l): l is ListingSummary => l != null);
    } else {
      result = listings.filter((l) => {
        if (!showHiddenGone && (l.userStatus === "hidden" || l.userStatus === "not_a_fit")) {
          return false;
        }
        if (!showHiddenGone && (l.staleStatus === "likely_unavailable" || l.listingStatus !== "active")) {
          return false;
        }
        return true;
      });
    }

    if (sort === "price_asc") return [...result].sort((a, b) => price(a) - price(b));
    if (sort === "price_desc") return [...result].sort((a, b) => price(b) - price(a));
    // default: search → keep score order; browse → newest first
    if (search) return result;
    return [...result].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
  }, [listings, search, showHiddenGone, sort]);

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

  const selected = listings?.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSearch={doSearch}
        onClear={clearSearch}
        searching={searching}
        searchError={searchError}
        search={search}
        resultCount={displayed.length}
        totalCount={listings?.length ?? 0}
        location={location}
        locationStatus={locationStatus}
        onRequestLocation={requestLocation}
        radiusMi={radiusMi}
        onRadiusChange={setRadiusMi}
        showHiddenGone={showHiddenGone}
        onToggleHiddenGone={() => setShowHiddenGone((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <MapView
            listings={displayed}
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
                Ingest real SF sources with <Code>npm run ingest -- --all</Code>, then reload.
              </p>
            </Overlay>
          )}
        </div>
        <ListingPanel
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
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
