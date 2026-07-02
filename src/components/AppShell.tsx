"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BadgeKind,
  ListingSummary,
  ListingsResponse,
  SearchResponse,
} from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import type { UserListingStatus } from "@/core/types";
import { SearchBar, type LocationStatus } from "./SearchBar";
import { EMPTY_PROGRESS, type SearchProgressState } from "./SearchProgress";
import { MapView } from "./MapView";
import { ListingPanel } from "./ListingPanel";
import { ListingDetail } from "./ListingDetail";

/** One NDJSON line from /api/search. */
type SearchStreamEvent =
  | { type: "stage"; stage: "assemble"; candidates: number }
  | { type: "stage"; stage: "prerank"; kept: number; ids?: string[] }
  | { type: "stage"; stage: "model_start"; model: string }
  | { type: "delta"; chars: number }
  | { type: "done"; result: SearchResponse }
  | { type: "error"; error: string };

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
  const [progress, setProgress] = useState<SearchProgressState>(EMPTY_PROGRESS);
  const [showHiddenGone, setShowHiddenGone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    setSearchError(null);
    setSearch(null);
    setProgress(EMPTY_PROGRESS);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: q,
          location: locationStatus === "granted" ? location : null,
          radiusMi: locationStatus === "granted" ? radiusMi : null,
          includeHiddenGone: showHiddenGone,
        }),
      });
      if (!res.body) throw new Error(`API error ${res.status}`);

      // Consume the NDJSON stream: live stage/delta events, then done|error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      const handle = (event: SearchStreamEvent) => {
        if (event.type === "stage") {
          setProgress((p) =>
            event.stage === "assemble"
              ? { ...p, candidates: event.candidates }
              : event.stage === "prerank"
                ? { ...p, kept: event.kept, keptIds: event.ids ?? null }
                : { ...p, model: event.model },
          );
        } else if (event.type === "delta") {
          setProgress((p) => ({ ...p, chars: event.chars }));
        } else if (event.type === "done") {
          finished = true;
          setSearch(event.result);
        } else if (event.type === "error") {
          finished = true;
          setSearchError(event.error);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line) as SearchStreamEvent);
        }
      }
      if (buffer.trim()) handle(JSON.parse(buffer.trim()) as SearchStreamEvent);
      if (!finished) setSearchError("search stream ended unexpectedly");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setSearchError(e instanceof Error ? e.message : String(e));
        setSearch(null);
      }
    } finally {
      if (abortRef.current === controller) {
        setSearching(false);
      }
    }
  }, [query, location, locationStatus, radiusMi, showHiddenGone]);

  const clearSearch = useCallback(() => {
    abortRef.current?.abort();
    setQuery("");
    setSearch(null);
    setSearchError(null);
    setSearching(false);
  }, []);

  const reasonById = useMemo(() => {
    const m = new Map<string, MatchInfo>();
    if (search) for (const mt of search.matches) m.set(mt.id, { score: mt.score, reason: mt.reason });
    return m;
  }, [search]);

  // Real coordinates for the search radar — every active listing with a fix.
  const radarPoints = useMemo(
    () =>
      (listings ?? [])
        .filter(
          (l) =>
            l.latitude != null &&
            l.longitude != null &&
            l.listingStatus === "active" &&
            l.staleStatus !== "likely_unavailable",
        )
        .map((l) => ({ id: l.id, lat: l.latitude!, lng: l.longitude! })),
    [listings],
  );

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
    <div className="relative h-full min-h-0 flex-1 overflow-hidden">
      {/* Full-bleed 3D stage */}
      <div className="absolute inset-0">
        <MapView
          listings={displayed}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          searching={searching}
          searchActive={search != null}
        />
      </div>

      {/* Floating command bar */}
      <div className="pointer-events-none absolute top-3 right-[404px] left-3 z-20 flex justify-center max-lg:right-3">
        <div className="pointer-events-auto w-full max-w-[820px]">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSearch={doSearch}
            onClear={clearSearch}
            searching={searching}
            searchError={searchError}
            search={search}
            location={location}
            locationStatus={locationStatus}
            onRequestLocation={requestLocation}
            radiusMi={radiusMi}
            onRadiusChange={setRadiusMi}
            showHiddenGone={showHiddenGone}
            onToggleHiddenGone={() => setShowHiddenGone((v) => !v)}
          />
        </div>
      </div>

      {/* Floating results panel */}
      <div className="absolute top-3 right-3 bottom-3 z-20 w-[392px] max-lg:hidden">
        <ListingPanel
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
          searching={searching}
          progress={progress}
          hasLocation={locationStatus === "granted"}
          radarPoints={radarPoints}
          userLocation={locationStatus === "granted" ? location : null}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

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
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-paper/60 backdrop-blur-sm">
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
