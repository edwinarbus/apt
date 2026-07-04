"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  BadgeKind,
  ListingSummary,
  ListingsResponse,
  SearchResponse,
} from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import { matchNeighborhood } from "@/core/neighborhoods";
import { pointInMultiPolygon, type MultiPolygonCoords } from "@/lib/geo";
import hoodsData from "@/data/sf-neighborhoods.json";
import type { UserListingStatus } from "@/core/types";
import { SearchBar } from "./SearchBar";
import { EMPTY_PROGRESS, type SearchProgressState } from "./SearchProgress";
import { PorterFab, ListingPanel, SortSelect, listingCountLabel } from "./ListingPanel";
import { ListingDetail } from "./ListingDetail";
import { PorterPanel } from "./PorterPanel";
import { SaveSearchDialog } from "./SaveSearchDialog";
import { WelcomeBackModal } from "./WelcomeBackModal";
import type { SavedSearchDto } from "@/lib/api-types";

// MapView pulls in maplibre-gl (a large client-only library). Split it into
// its own chunk so the search bar and results panel can paint and hydrate
// immediately instead of waiting on the map bundle to download and parse.
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-paper">
      <span className="flex items-center gap-2 text-[13px] text-muted">
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
        Loading map…
      </span>
    </div>
  ),
});

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
  // Bumped once per search ATTEMPT (not per result). MapView compares this
  // against what it last framed the camera to, so a new search always
  // re-frames — even one that repeats the same neighborhood name or lands an
  // overlapping result set — while a status change (hide/thumbs-down) that
  // merely shrinks the current results never does (it doesn't bump this).
  const [searchSeq, setSearchSeq] = useState(0);
  // Hidden/unavailable listings stay filtered out (the toggle was removed as
  // chrome).
  const showHiddenGone = false;
  const abortRef = useRef<AbortController | null>(null);

  // Neighborhood isolate (click a hood polygon on the map)
  const [selectedHood, setSelectedHood] = useState<string | null>(null);

  // Optional filter: hide listings flagged verify-carefully / suspicious.
  const [hideSuspicious, setHideSuspicious] = useState(false);

  // Overnight scout panel + saved (watched) searches
  const [scoutOpen, setScoutOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedQueries, setSavedQueries] = useState<Set<string>>(new Set());
  const [savedDtos, setSavedDtos] = useState<SavedSearchDto[] | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeCheckedRef = useRef(false);

  const refreshSavedSearches = useCallback(() => {
    fetch("/api/searches")
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((d: { searches: SavedSearchDto[] }) => setSavedDtos(d.searches))
      .catch(() => setSavedDtos([]));
  }, []);
  useEffect(() => refreshSavedSearches(), [refreshSavedSearches]);

  // Total new matches the overnight Scout surfaced across watched searches.
  const scoutNewCount = useMemo(
    () => (savedDtos ?? []).reduce((n, s) => n + s.newMatchCount, 0),
    [savedDtos],
  );

  // First open of the session: if the Scout found new matches while away, greet
  // the user with them. Once per browser session.
  useEffect(() => {
    if (welcomeCheckedRef.current || !listings || !savedDtos) return;
    welcomeCheckedRef.current = true;
    let seen = false;
    try {
      seen = sessionStorage.getItem("apt.welcomed") === "1";
    } catch {
      /* sessionStorage may be unavailable */
    }
    if (!seen && savedDtos.some((s) => s.newMatchCount > 0)) {
      setWelcomeOpen(true);
      try {
        sessionStorage.setItem("apt.welcomed", "1");
      } catch {
        /* ignore */
      }
    }
  }, [listings, savedDtos]);

  // Mobile results drawer (below lg the panel becomes a bottom sheet).
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape walks back one layer at a time: modals close themselves first;
  // then a selected listing deselects; then an isolated hood releases.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || detailOpen || scoutOpen) return;
      if (selectedId) {
        setSelectedId(null);
        return;
      }
      setSelectedHood(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen, scoutOpen, selectedId]);

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json() as Promise<ListingsResponse>;
      })
      .then((data) => setListings(data.listings))
      .catch((e) => setError(e.message));
  }, []);

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
    // Drop any selected listing (and its pinned photo card): a new search is a
    // fresh context, and leaving one selected means its camera effect re-fires
    // when the results update `listings` and yanks the map back onto the old
    // apartment — overriding the fly-in to a neighborhood named in the query.
    setSelectedId(null);
    setSearching(true);
    setSearchError(null);
    setSearch(null);
    setSearchSeq((s) => s + 1);
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
          location: null,
          radiusMi: null,
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
  }, [query, showHiddenGone]);

  const clearSearch = useCallback(() => {
    abortRef.current?.abort();
    setQuery("");
    setSearch(null);
    setSearchError(null);
    setSearching(false);
  }, []);

  // Save the current search so the overnight Scout watches it (+ optionally
  // drafts applications for new matches). Derives a light neighborhood filter
  // from the query; the full natural-language query is stored for provenance.
  const saveCurrentSearch = useCallback(
    async ({ name, autoApply }: { name: string; autoApply: boolean }) => {
      const q = query.trim();
      const hood = matchNeighborhood(q);
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          query: q,
          autoApply,
          criteria: hood ? { neighborhoods: [hood.name] } : undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      setSavedQueries((s) => new Set(s).add(q));
      setSaveOpen(false);
      refreshSavedSearches(); // update the Scout badge + panel
      setScoutOpen(true); // reveal the watched search + what Scout will do
    },
    [query, refreshSavedSearches],
  );

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

  // A neighborhood named in the search ("studios near Japantown") — highlighted
  // on the map while the search runs and after it lands.
  const searchHood = useMemo(() => {
    const q = search?.query ?? (searching ? query : "");
    return q ? (matchNeighborhood(q)?.name ?? null) : null;
  }, [search, searching, query]);

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

    if (hideSuspicious) {
      result = result.filter(
        (l) =>
          !l.badges.includes("suspicious") && !l.badges.includes("verify_carefully"),
      );
    }

    if (sort === "price_asc") return [...result].sort((a, b) => price(a) - price(b));
    if (sort === "price_desc") return [...result].sort((a, b) => price(b) - price(a));
    // default: search → keep score order; browse → newest first
    if (search) return result;
    return [...result].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
  }, [listings, search, showHiddenGone, sort, hoodPolygon, hideSuspicious]);

  const select = useCallback((id: string | null, openDetail = true) => {
    setSelectedId(id);
    if (id && openDetail) setDetailOpen(true);
  }, []);

  // Deep-linkable listing URL: `?listing=<id>`. Managed via the raw History
  // API (not next/navigation's router) so opening/closing a listing never
  // triggers an actual Next.js route transition — the map/search state
  // (camera position, live results) stays completely undisturbed while the
  // open listing still gets a shareable, bookmarkable URL.

  // On mount, open whatever listing (if any) the URL names. A genuine mount
  // side effect (reading the browser URL), not derived state.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("listing");
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(id);
      setDetailOpen(true);
    }
  }, []);

  // Keep the URL in sync with detailOpen/selectedId: push a history entry when
  // a listing opens, and unwind it (or strip the param) when it closes. Reads
  // the CURRENT browser URL fresh each time rather than tracking a separate
  // "did I cause this" flag, so this is naturally a no-op when the state
  // change was itself driven by a popstate event (the URL already matches).
  useEffect(() => {
    const url = new URL(window.location.href);
    const currentParam = url.searchParams.get("listing");
    if (detailOpen && selectedId) {
      if (currentParam !== selectedId) {
        url.searchParams.set("listing", selectedId);
        window.history.pushState({ aptListing: selectedId }, "", url);
      }
    } else if (currentParam) {
      // If the top history entry is the one pushed for opening this exact
      // listing, going back is the natural, symmetric close. Otherwise (the
      // page loaded directly on a shared link, so there's no "before" state
      // in this app to return to) just strip the param in place.
      if ((window.history.state as { aptListing?: string } | null)?.aptListing === currentParam) {
        window.history.back();
      } else {
        url.searchParams.delete("listing");
        window.history.replaceState(null, "", url);
      }
    }
  }, [detailOpen, selectedId]);

  // Real back/forward navigation: reflect whatever the resulting URL names.
  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get("listing");
      if (id) {
        setSelectedId(id);
        setDetailOpen(true);
      } else {
        setDetailOpen(false);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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
  // A full-screen modal is up → make the map inert so no click, drag, or scroll
  // ever leaks through to it underneath.
  const anyModalOpen = detailOpen || scoutOpen || saveOpen || welcomeOpen;

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden">
      {/* 3D stage — its own viewport, LEFT of the results rail on desktop so the
          city is never framed behind the panel; full-bleed on mobile. */}
      <div className={`absolute inset-0 md:right-[396px] ${anyModalOpen ? "pointer-events-none" : ""}`}>
        <MapView
          listings={displayed}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          reasons={reasonById}
          searching={searching}
          searchActive={search != null}
          selectedHood={selectedHood}
          onHoodSelect={setSelectedHood}
          highlightHood={searchHood}
          searchToken={searchSeq}
          scanIds={progress.keptIds}
          radarPoints={radarPoints}
          drawerOpen={drawerOpen}
        />
      </div>

      {/* App header — brand + search, one bar (top-left, never touching the rail) */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 md:right-auto md:w-[620px] md:max-w-[calc(100%-408px)]">
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

      {/* Results rail — tablet + desktop. Starts a bit lower than top-3 to
          leave the Porter FAB (rendered separately, floating above) its own
          clear strip instead of overlapping the panel's rounded corner. */}
      <div className="absolute top-16 right-3 bottom-3 z-20 w-[384px] max-md:hidden">
        <ListingPanel
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
          searching={searching}
          loading={listings === null}
          progress={progress}
          interpretation={search?.interpretation ?? null}
          hoodName={selectedHood}
          selectedId={selectedId}
          onSelect={(id) => select(id, false)}
          sort={sort}
          onSortChange={setSort}
          hideSuspicious={hideSuspicious}
          onToggleSuspicious={() => setHideSuspicious((v) => !v)}
          onSaveSearch={() => setSaveOpen(true)}
          searchSaved={savedQueries.has(query.trim())}
        />
      </div>

      {/* Porter — pulled out of the panel/drawer entirely so it's always
          reachable regardless of panel/drawer state, on any screen size.
          Desktop: floats in the gap above the results rail. Mobile: floats
          over the map just below the search header, clear of the drawer
          (anchored from the top, so it's unaffected by the drawer opening). */}
      <PorterFab
        badge={scoutNewCount}
        onClick={() => setScoutOpen(true)}
        className="absolute top-20 right-3 z-30 md:top-3"
      />

      {/* Results drawer — mobile / narrow (bottom sheet) */}
      <MobileDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        count={displayed.length}
        searching={searching}
        loading={listings === null}
        searchActive={search != null}
        hoodName={selectedHood}
        sort={sort}
        onSortChange={setSort}
        hideSuspicious={hideSuspicious}
        onToggleSuspicious={() => setHideSuspicious((v) => !v)}
      >
        <ListingPanel
          chromeless
          hideHeader
          listings={displayed}
          reasons={reasonById}
          searchActive={search != null}
          searching={searching}
          loading={listings === null}
          progress={progress}
          hoodName={selectedHood}
          selectedId={selectedId}
          onSelect={(id) => select(id, false)}
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

      {scoutOpen && (
        <PorterPanel
          listings={listings ?? []}
          initialSearches={savedDtos}
          onClose={() => setScoutOpen(false)}
          onSelect={(id) => select(id)}
          onChanged={refreshSavedSearches}
        />
      )}

      {saveOpen && (
        <SaveSearchDialog
          query={query}
          interpretation={search?.interpretation ?? null}
          matchCount={displayed.length}
          onClose={() => setSaveOpen(false)}
          onConfirm={saveCurrentSearch}
        />
      )}

      {welcomeOpen && savedDtos && listings && (
        <WelcomeBackModal
          searches={savedDtos}
          listings={listings}
          onSelect={(id) => select(id)}
          onOpenScout={() => setScoutOpen(true)}
          onClose={() => setWelcomeOpen(false)}
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
  loading,
  searchActive,
  hoodName,
  sort,
  onSortChange,
  hideSuspicious,
  onToggleSuspicious,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  count: number;
  searching?: boolean;
  loading?: boolean;
  searchActive?: boolean;
  hoodName?: string | null;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  hideSuspicious?: boolean;
  onToggleSuspicious?: () => void;
  children: React.ReactNode;
}) {
  const label = listingCountLabel({ count, searching, loading, searchActive, hoodName });
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">
      <div
        className="textured pointer-events-auto relative flex flex-col overflow-hidden rounded-t-xl border-x-2 border-t-2 border-white/30 bg-panel/98 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_-14px_50px_-8px_rgba(0,0,0,0.9)] transition-[height] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
        style={{
          height: open
            ? "min(52dvh, 440px)"
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
          {open && onToggleSuspicious && (
            <button
              type="button"
              onClick={onToggleSuspicious}
              aria-pressed={hideSuspicious}
              aria-label={hideSuspicious ? "Show suspicious listings" : "Hide suspicious listings"}
              title={hideSuspicious ? "Showing all listings" : "Hide verify-carefully / suspicious listings"}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                hideSuspicious
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.3 5.2a11 11 0 0 1 1.7-.2c6 0 9 6 9 7a12.6 12.6 0 0 1-2 2.7M6.6 6.6C3.7 8.3 2 11.4 2 12c0 1 3 7 10 7 2 0 3.7-.5 5.1-1.3M3 3l18 18" />
              </svg>
            </button>
          )}
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
              className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
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
