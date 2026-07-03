"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BadgeKind,
  ListingSummary,
  ListingsResponse,
  SearchResponse,
} from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import { pointInMultiPolygon, type MultiPolygonCoords } from "@/lib/geo";
import hoodsData from "@/data/sf-neighborhoods.json";
import type { UserListingStatus } from "@/core/types";
import { SearchBar, type LocationStatus } from "./SearchBar";
import { EMPTY_PROGRESS, type SearchProgressState } from "./SearchProgress";
import { MapView } from "./MapView";
import { ListingPanel, SortSelect, listingCountLabel } from "./ListingPanel";
import { ListingDetail } from "./ListingDetail";

/** One NDJSON line from /api/search. */
type SearchStreamEvent =
  | { type: "stage"; stage: "assemble"; candidates: number }
  | { type: "stage"; stage: "prerank"; kept: number; ids?: string[] }
  | { type: "stage"; stage: "model_start"; model: string }
  | { type: "thinking"; delta: string }
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
  // Hidden/unavailable listings stay filtered out (the toggle was removed as
  // chrome); search still anchors to the browser location when it's granted.
  const showHiddenGone = false;
  const radiusMi = 10;
  const abortRef = useRef<AbortController | null>(null);

  // Location state
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");

  // Neighborhood isolate (click a hood polygon on the map)
  const [selectedHood, setSelectedHood] = useState<string | null>(null);

  // Mobile results drawer (below lg the panel becomes a bottom sheet).
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape releases the lifted neighborhood (when no modal is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !detailOpen) setSelectedHood(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen]);

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
    const startedAt = Date.now();
    setProgress({ ...EMPTY_PROGRESS, startedAt });
    setDrawerOpen(true); // raise the mobile sheet so the live feed is visible
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
        } else if (event.type === "thinking") {
          setProgress((p) => ({ ...p, thinking: p.thinking + event.delta }));
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

  // Polygon of the isolated neighborhood (exact containment beats name tags).
  const hoodPolygon = useMemo(() => {
    if (!selectedHood) return null;
    const f = (hoodsData as GeoJSON.FeatureCollection).features.find(
      (x) => (x.properties as { name: string }).name === selectedHood,
    );
    return f ? ((f.geometry as GeoJSON.MultiPolygon).coordinates as MultiPolygonCoords) : null;
  }, [selectedHood]);

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

    if (hoodPolygon) {
      result = result.filter(
        (l) =>
          l.latitude != null &&
          l.longitude != null &&
          pointInMultiPolygon(l.longitude, l.latitude, hoodPolygon),
      );
    }

    if (sort === "price_asc") return [...result].sort((a, b) => price(a) - price(b));
    if (sort === "price_desc") return [...result].sort((a, b) => price(b) - price(a));
    // default: search → keep score order; browse → newest first
    if (search) return result;
    return [...result].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
  }, [listings, search, showHiddenGone, sort, hoodPolygon]);

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
          selectedHood={selectedHood}
          onHoodSelect={setSelectedHood}
          scanIds={progress.keptIds}
          radarPoints={radarPoints}
        />
      </div>

      {/* App header — brand + search, one bar; kept clear of the results rail */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 md:right-[404px]">
        <div className="pointer-events-auto">
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSearch={doSearch}
            onClear={clearSearch}
            searching={searching}
            searchError={searchError}
            search={search}
          />
        </div>
      </div>

      {/* Results rail — tablet + desktop */}
      <div className="absolute top-3 right-3 bottom-3 z-20 w-[384px] max-md:hidden">
        <ListingPanel
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
          searching={searching}
          progress={progress}
          hoodName={selectedHood}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      {/* Results drawer — mobile / narrow (bottom sheet) */}
      <MobileDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        count={displayed.length}
        searching={searching}
        searchActive={search != null}
        hoodName={selectedHood}
        sort={sort}
        onSortChange={setSort}
      >
        <ListingPanel
          chromeless
          hideHeader
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
          searching={searching}
          progress={progress}
          hoodName={selectedHood}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          sort={sort}
          onSortChange={setSort}
        />
      </MobileDrawer>

      {error && (
        <Overlay>
          <p className="text-[15px] font-semibold text-ink">Could not load listings</p>
          <p className="mt-1.5 text-[12.5px] text-muted">{error}</p>
        </Overlay>
      )}
      {listings !== null && listings.length === 0 && (
        <Overlay>
          <p className="text-[15px] font-semibold text-ink">No listings yet</p>
          <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-muted">
            Ingest SF sources with <Code>npm run ingest -- --all</Code>, then reload.
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

/** Bottom-sheet results drawer for narrow viewports (below `lg`). */
function MobileDrawer({
  open,
  onToggle,
  count,
  searching,
  searchActive,
  hoodName,
  sort,
  onSortChange,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  count: number;
  searching?: boolean;
  searchActive?: boolean;
  hoodName?: string | null;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  children: React.ReactNode;
}) {
  const label = listingCountLabel({ count, searching, searchActive, hoodName });
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">
      <div
        className="pointer-events-auto relative flex flex-col overflow-hidden rounded-t-xl border-x border-t border-line bg-surface/97 shadow-[0_-10px_44px_rgba(0,0,0,0.55)] transition-[height] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
        style={{
          height: open
            ? "min(70dvh, 560px)"
            : "calc(52px + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Grip affordance */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1.5 mx-auto h-1 w-9 rounded-full bg-line-strong"
        />
        <div className="flex items-center gap-2 border-b border-line px-3 pt-3 pb-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-baseline gap-1.5"
          >
            {label.n && (
              <span className="tnum text-[15px] leading-none font-semibold text-ink">{label.n}</span>
            )}
            <span className="text-[13px] text-muted">{label.unit}</span>
            {label.scope && (
              <span className="truncate text-[13px] text-accent">· {label.scope}</span>
            )}
          </button>
          {open && <SortSelect sort={sort} searchActive={searchActive} onSortChange={onSortChange} />}
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? "Collapse results" : "Expand results"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className={`transition-transform duration-300 ${open ? "" : "rotate-180"}`}
              aria-hidden
            >
              <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-paper/70 p-4 backdrop-blur-[2px]">
      <div className="max-w-sm rounded-lg border border-line bg-surface px-7 py-6 text-center shadow-[0_16px_50px_rgba(0,0,0,0.55)]">
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm border border-line bg-elevated px-1.5 py-0.5 font-mono text-[12px] text-ink">
      {children}
    </code>
  );
}
