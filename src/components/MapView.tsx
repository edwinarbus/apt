"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import type { ListingSummary } from "@/lib/api-types";
import { BADGE_COLORS, DEFAULT_MARKER_COLOR, markerColor } from "@/lib/badges";
import { fmtMoneyShort } from "@/lib/format";
import { multiPolygonBounds, type MultiPolygonCoords } from "@/lib/geo";
import hoodsData from "@/data/sf-neighborhoods.json";

/**
 * The Navy-ops tactical stage.
 *
 * - Dark navy basemap (Positron recolored at runtime); ONLY San Francisco is
 *   visible — the rest of the world is masked and the camera is hard-bounded.
 * - A flat, top-down operational map for browsing (extruded buildings give depth).
 * - The 37 official planning neighborhoods render as HUD polygons. Clicking one
 *   LIFTS it out of the map: boosted terrain raises the neighborhood as a
 *   satellite-imagery plateau while the rest dims, the camera swoops to a
 *   three-quarter angle, and its listings ride the plateau as price pills.
 *   Deselecting lowers it back to the flat map. Terrain exists only while lifted.
 * - While a search runs, the sonar plays ON the map: a rotating beam and
 *   expanding rings sweep from your position, then the REAL shortlisted
 *   listings ping and a designator hops between them as the camera hones in
 *   on where they concentrate.
 * - All motion honors prefers-reduced-motion and hidden tabs.
 */

const SF_CENTER: [number, number] = [-122.4384, 37.7639];
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const SF_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-122.61, 37.66],
  [-122.25, 37.9],
];

const PAPER = "#070d18";
const ACCENT = "#47aede"; // interaction: selection, search targets, scan
const HOOD = "#4a90b8"; // neighborhood geometry — controlled steel-cyan
const HALO = "#06090f"; // marker stroke = background, for a crisp cut-out edge
/** Real-terrain relief exaggeration while a neighborhood is shown in 3D. */
const TERRAIN_EXAGGERATION = 1.4;

// Clusters are aggregates of mixed status → neutral graphite, denser = lighter.
const CLUSTER_COLOR_BROWSE = [
  "step", ["get", "point_count"],
  "#17212e", 10, "#1f2c3a", 40, "#293845",
] as unknown as maplibregl.ExpressionSpecification;

const LEGEND: Array<[string, string]> = [
  [DEFAULT_MARKER_COLOR, "Listing"],
  [BADGE_COLORS.new_today, "New / price drop"],
  [BADGE_COLORS.verify_carefully, "Verify"],
  [BADGE_COLORS.saved, "Saved"],
  [BADGE_COLORS.stale, "Stale"],
];

export interface RadarPoint {
  id: string;
  lat: number;
  lng: number;
}

interface HoodFeature {
  properties: { name: string };
  geometry: { type: "MultiPolygon"; coordinates: MultiPolygonCoords };
}
const HOODS = (hoodsData as unknown as { features: HoodFeature[] }).features;

const WORLD_RING: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

function outsideSfMask(): GeoJSON.Feature {
  const holes: [number, number][][] = [];
  for (const f of HOODS) {
    for (const poly of f.geometry.coordinates) if (poly[0]) holes.push(poly[0]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [WORLD_RING, ...holes] },
  };
}

function hoodByName(name: string | null): HoodFeature | undefined {
  return name ? HOODS.find((f) => f.properties.name === name) : undefined;
}

/** Signed shoelace area (used to pick the largest polygon per hood). */
function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** Area-weighted centroid of a ring, with a vertex-average fallback. */
function ringCentroid(ring: [number, number][]): [number, number] {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const s = ring.reduce((p, c) => [p[0] + c[0], p[1] + c[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** One label point per neighborhood, at the centroid of its largest polygon. */
function hoodLabelPoints(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: HOODS.map((h) => {
      let bestRing: [number, number][] | null = null;
      let bestArea = -1;
      for (const poly of h.geometry.coordinates) {
        const ring = poly[0] as [number, number][] | undefined;
        if (!ring) continue;
        const area = Math.abs(ringArea(ring));
        if (area > bestArea) {
          bestArea = area;
          bestRing = ring;
        }
      }
      return {
        type: "Feature" as const,
        properties: { name: h.properties.name },
        geometry: {
          type: "Point" as const,
          coordinates: bestRing ? ringCentroid(bestRing) : [0, 0],
        },
      };
    }),
  };
}

function hoodRevealMask(name: string | null): GeoJSON.Feature {
  const holes: [number, number][][] = [];
  const hood = hoodByName(name);
  for (const poly of hood?.geometry.coordinates ?? []) if (poly[0]) holes.push(poly[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [WORLD_RING, ...holes] },
  };
}

/* ---------- Terrain: real relief under a selected neighborhood ----------
 * The browse map is flat; selecting a hood shows it in 3D with the REAL terrain
 * (public terrarium elevation, proxied same-origin) — no lift, no boost. The
 * hood is revealed with satellite imagery and a highlighted outline. */
const DEM_TILE_URL = "/api/dem/{z}/{x}/{y}.png";

function lat2tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

const SAT_TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/** Tile x/y range covering a hood's bbox at a zoom, clamped to the world. */
function hoodTileRange(
  hood: HoodFeature,
  zoom: number,
): Array<[number, number, number]> {
  const [[bw, bs], [be, bn]] = multiPolygonBounds(hood.geometry.coordinates);
  const n = 2 ** zoom;
  const xMin = Math.max(0, Math.floor(((bw + 180) / 360) * n));
  const xMax = Math.min(n - 1, Math.floor(((be + 180) / 360) * n));
  const yMin = Math.max(0, lat2tileY(bn, zoom));
  const yMax = Math.min(n - 1, lat2tileY(bs, zoom));
  const out: Array<[number, number, number]> = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) out.push([zoom, x, y]);
  }
  return out;
}

function warmImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

/** Run best-effort jobs with a concurrency cap; never rejects. */
async function runLimited(jobs: Array<() => Promise<unknown>>, limit: number) {
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        await job();
      } catch {
        /* preload is best-effort */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

/**
 * Warm the Esri satellite tiles a selected neighborhood reveals, so the imagery
 * doesn't pop in after the camera settles. Best-effort and bounded.
 */
async function preloadHoodSatellite(hoodName: string): Promise<void> {
  const hood = hoodByName(hoodName);
  if (!hood) return;
  const jobs: Array<() => Promise<unknown>> = [];
  for (const z of [13, 14]) {
    for (const [zz, x, y] of hoodTileRange(hood, z)) {
      jobs.push(() => warmImage(SAT_TILE_URL(zz, x, y)));
    }
  }
  if (jobs.length > 120) return;
  await runLimited(jobs, 8);
}

const HILLSHADE_PAINT: Record<string, unknown> = {
  "hillshade-shadow-color": "#020710",
  "hillshade-highlight-color": "#4a6d94",
  "hillshade-accent-color": "#0b1c30",
  "hillshade-exaggeration": 0.55,
};

/**
 * Turn on the real (unboosted) terrain + hillshade so the selected hood shows
 * genuine relief. The browse map stays flat — terrain only exists while a hood
 * is isolated, so the idle map never carries a DEM.
 */
function enableTerrain(map: maplibregl.Map, exaggeration = TERRAIN_EXAGGERATION) {
  try {
    if (!map.getSource("dem")) {
      map.addSource("dem", {
        type: "raster-dem",
        tiles: [DEM_TILE_URL],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 12,
        attribution: "Terrain: Mapzen/AWS",
      });
    }
    if (!map.getLayer("hillshade-base")) {
      map.addLayer(
        { id: "hillshade-base", type: "hillshade", source: "dem", paint: HILLSHADE_PAINT as never },
        "hood-reveal-mask",
      );
    }
    map.setTerrain({ source: "dem", exaggeration });
  } catch (err) {
    console.warn("[apt map] enable terrain failed", err);
  }
}

/** Tear terrain back down to the flat browse map. */
function removeTerrain(map: maplibregl.Map) {
  try {
    map.setTerrain(null);
    if (map.getLayer("hillshade-base")) map.removeLayer("hillshade-base");
    if (map.getSource("dem")) map.removeSource("dem");
  } catch (err) {
    console.warn("[apt map] terrain teardown failed", err);
  }
}

/** Recolor the light Positron style into the navy ops palette before boot. */
function darkenStyle(style: StyleSpecification): StyleSpecification {
  const TEXT = "#8ba3c2";
  const TEXT_MINOR = "#5f7492";
  for (const layer of style.layers ?? []) {
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    const id = layer.id.toLowerCase();
    if (layer.type === "background") {
      paint["background-color"] = PAPER;
    } else if (layer.type === "fill") {
      if (id.includes("water")) paint["fill-color"] = "#0c1a2e";
      else if (id.includes("green") || id.includes("park") || id.includes("wood") || id.includes("grass"))
        paint["fill-color"] = "#0d1a24";
      else if (id.includes("building")) paint["fill-color"] = "#131f33";
      else paint["fill-color"] = "#0b1526";
      delete paint["fill-outline-color"];
    } else if (layer.type === "line") {
      if (id.includes("water")) paint["line-color"] = "#12253c";
      else if (id.includes("casing")) paint["line-color"] = "#101d31";
      else if (id.includes("boundary") || id.includes("admin")) paint["line-color"] = "#2a3d5c";
      else if (id.includes("rail") || id.includes("transit")) paint["line-color"] = "#1c2c44";
      else paint["line-color"] = "#22344f";
    } else if (layer.type === "symbol") {
      paint["text-color"] = id.includes("place") || id.includes("city") ? TEXT : TEXT_MINOR;
      paint["text-halo-color"] = PAPER;
      paint["text-halo-width"] = 1.1;
      delete paint["icon-color"];
    }
    layer.paint = paint as never;
  }
  return style;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ---------- Drawn marker assets ----------
 * IMPORTANT: MapLibre positions a marker by writing `style.transform` on the
 * ROOT element it's given. Any CSS animation/transition/hover that touches
 * transform must therefore live on an INNER wrapper, or the marker teleports
 * to the map origin while animating. Every asset below is root(plain) → inner.
 */

function withRoot(inner: HTMLElement): HTMLDivElement {
  const root = document.createElement("div");
  root.appendChild(inner);
  return root;
}

/** Which status accent a listing's marker should carry. */
function pillKind(l: ListingSummary): "verify" | "saved" | "stale" | "default" {
  if (l.userStatus === "saved") return "saved";
  if (l.userStatus === "hidden" || l.userStatus === "not_a_fit") return "stale";
  const b = l.badges;
  if (b.includes("saved")) return "saved";
  if (b.includes("verify_carefully") || b.includes("watch") || b.includes("suspicious")) return "verify";
  if (b.includes("stale") || b.includes("likely_unavailable")) return "stale";
  return "default";
}

function bedsShort(l: ListingSummary): string | null {
  if (l.bedrooms == null) return null;
  return l.bedrooms === 0 ? "Studio" : `${l.bedrooms} bd`;
}

/** Compact price pill — the on-map listing marker at closer zoom. */
function makePriceElement(
  l: ListingSummary,
  active: boolean,
  onClick: () => void,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `price-pill pill-${pillKind(l)}${active ? " pill-active" : ""}`;
  el.textContent = fmtMoneyShort(l.priceEffectiveMonthly ?? l.priceMonthly) ?? "—";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return withRoot(el);
}

/** Selected listing — the one place a photo appears on the map. */
function makePhotoCardElement(l: ListingSummary, onClick: () => void): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "photo-card";
  const frame = document.createElement("div");
  frame.className = "photo-card-frame";
  if (l.primaryPhotoUrl) {
    const img = document.createElement("img");
    img.className = "photo-card-img";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 148;
    img.height = 82;
    img.onerror = () => frame.classList.add("no-photo");
    img.src = l.primaryPhotoUrl;
    frame.appendChild(img);
  } else {
    frame.classList.add("no-photo");
  }
  const bar = document.createElement("div");
  bar.className = "photo-card-bar";
  const price = document.createElement("span");
  price.className = "photo-card-price";
  price.textContent = fmtMoneyShort(l.priceEffectiveMonthly ?? l.priceMonthly) ?? "—";
  bar.appendChild(price);
  const beds = bedsShort(l);
  if (beds) {
    const meta = document.createElement("span");
    meta.className = "photo-card-meta";
    meta.textContent = beds;
    bar.appendChild(meta);
  }
  frame.appendChild(bar);
  el.appendChild(frame);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return withRoot(el);
}

function makeRippleElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "click-ripple";
  return withRoot(el);
}

function toGeoJson(listings: ListingSummary[]) {
  return {
    type: "FeatureCollection" as const,
    features: listings
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [l.longitude!, l.latitude!] as [number, number],
        },
        properties: {
          id: l.id,
          color: markerColor(l.badges),
          priceShort: fmtMoneyShort(l.priceEffectiveMonthly ?? l.priceMonthly),
          approximate: l.geocodePrecision === "neighborhood" || l.geocodePrecision === "city",
        },
      })),
  };
}

const EMPTY_FC = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

export function MapView({
  listings,
  selectedId,
  onSelect,
  searching,
  searchActive,
  selectedHood,
  onHoodSelect,
  scanIds,
  radarPoints,
}: {
  listings: ListingSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searching?: boolean;
  searchActive?: boolean;
  selectedHood: string | null;
  onHoodSelect: (name: string | null) => void;
  /** the actual shortlisted listing ids streamed mid-search */
  scanIds?: string[] | null;
  /** id → coords for every active listing */
  radarPoints?: RadarPoint[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const listingsRef = useRef(listings);
  const onSelectRef = useRef(onSelect);
  const onHoodSelectRef = useRef(onHoodSelect);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedHoodRef = useRef<string | null>(null);
  const hoveredHoodRef = useRef<string | null>(null);
  const lockMarkerRef = useRef<maplibregl.Marker | null>(null);
  const thumbsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const searchActiveRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const refreshThumbsRef = useRef<() => void>(() => {});

  /* ---------- Price-pill markers (imperative, viewport-managed) ----------
   * Compact price pills at closer zoom / while isolated or searching; the
   * selected listing gets its own photo card, so it's excluded here. */
  const refreshThumbs = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const zoom = map.getZoom();
    const hoodMode = selectedHoodRef.current != null;
    const show = hoodMode || searchActiveRef.current || zoom >= 13.4;
    const thumbs = thumbsRef.current;
    if (!show) {
      for (const m of thumbs.values()) m.remove();
      thumbs.clear();
      return;
    }
    const bounds = map.getBounds();
    const cap = 60;
    const selectedId = selectedIdRef.current;
    const wanted: ListingSummary[] = [];
    for (const l of listingsRef.current) {
      if (l.latitude == null || l.longitude == null) continue;
      if (l.id === selectedId) continue; // shown as a photo card instead
      if (!hoodMode && !bounds.contains([l.longitude, l.latitude])) continue;
      wanted.push(l);
      if (wanted.length >= cap) break;
    }
    const wantedIds = new Set(wanted.map((l) => l.id));
    for (const [id, m] of thumbs) {
      if (!wantedIds.has(id)) {
        m.remove();
        thumbs.delete(id);
      }
    }
    for (const l of wanted) {
      let marker = thumbs.get(l.id);
      if (!marker) {
        const el = makePriceElement(l, searchActiveRef.current, () => {
          spawnRipple(map, [l.longitude!, l.latitude!]);
          onSelectRef.current(l.id);
        });
        marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([l.longitude!, l.latitude!])
          .addTo(map);
        thumbs.set(l.id, marker);
      }
    }
  };
  useEffect(() => {
    listingsRef.current = listings;
    onSelectRef.current = onSelect;
    onHoodSelectRef.current = onHoodSelect;
    selectedIdRef.current = selectedId;
    refreshThumbsRef.current = refreshThumbs;
  });

  /* ---------- Map boot ---------- */
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    const reduced = prefersReducedMotion();

    (async () => {
      let style: StyleSpecification | string = MAP_STYLE_URL;
      try {
        const res = await fetch(MAP_STYLE_URL);
        if (res.ok) style = darkenStyle((await res.json()) as StyleSpecification);
      } catch {
        /* fall back to hosted light style rather than no map */
      }
      if (cancelled) return;

      const map = new maplibregl.Map({
        container,
        style,
        center: SF_CENTER,
        zoom: reduced ? 12.4 : 11.4,
        pitch: 0,
        bearing: 0,
        minZoom: 10.4,
        maxPitch: 68,
        maxBounds: SF_MAX_BOUNDS,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
        "bottom-right",
      );
      map.on("error", (e) => console.error("[apt map]", e.error?.message ?? e));
      (window as unknown as { __aptMap?: maplibregl.Map }).__aptMap = map;

      map.on("load", () => {
        try {
          map.setSky({
            "sky-color": "#03060c",
            "horizon-color": "#0d1c30",
            "fog-color": "#0a1526",
            "sky-horizon-blend": 0.5,
            "horizon-fog-blend": 0.5,
            "fog-ground-blend": 0.9,
            "atmosphere-blend": [
              "interpolate", ["linear"], ["zoom"],
              10, 0.22, 13, 0.35, 16, 0.1,
            ] as never,
          });
        } catch (err) {
          console.warn("[apt map] sky unavailable", err);
        }

        // SF-only mask
        map.addSource("outside-sf", { type: "geojson", data: outsideSfMask() });
        map.addLayer({
          id: "outside-sf-mask",
          type: "fill",
          source: "outside-sf",
          paint: { "fill-color": PAPER, "fill-opacity": 0.94 },
        });

        // Lift assets (hidden until a hood is isolated): satellite imagery on the
        // raised plateau + a reveal mask that dims everything outside it. Terrain
        // itself is only built on select (browse stays flat), so the idle map
        // never carries a DEM.
        map.addSource("satellite", {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Imagery: Esri",
        });
        map.addLayer({
          id: "hood-satellite",
          type: "raster",
          source: "satellite",
          layout: { visibility: "none" },
          // Cool recon grade so the imagery reads with the tactical theme.
          paint: {
            "raster-opacity": 0.9,
            "raster-saturation": -0.4,
            "raster-contrast": 0.15,
            "raster-brightness-max": 0.9,
            "raster-hue-rotate": 8,
          },
        });
        map.addSource("hood-reveal", { type: "geojson", data: hoodRevealMask(null) });
        map.addLayer({
          id: "hood-reveal-mask",
          type: "fill",
          source: "hood-reveal",
          layout: { visibility: "none" },
          paint: { "fill-color": PAPER, "fill-opacity": 0.9 },
        });

        // Extruded buildings give the pitched map its depth.
        let buildingSource: string | null = null;
        try {
          const layers = map.getStyle().layers ?? [];
          const buildingLayer = layers.find(
            (l) => "source-layer" in l && l["source-layer"] === "building",
          );
          if (buildingLayer && "source" in buildingLayer) {
            buildingSource = buildingLayer.source as string;
            map.addLayer({
              id: "apt-3d-buildings",
              type: "fill-extrusion",
              source: buildingSource,
              "source-layer": "building",
              minzoom: 13,
              paint: {
                "fill-extrusion-color": "#1d2f4b",
                "fill-extrusion-height": [
                  "interpolate", ["linear"], ["zoom"],
                  13, 0,
                  13.8, ["coalesce", ["get", "render_height"], 10],
                ],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.85,
              },
            });
          }
        } catch (err) {
          console.warn("[apt map] 3d buildings unavailable", err);
        }

        // Neighborhood HUD polygons
        map.addSource("hoods", {
          type: "geojson",
          data: hoodsData as GeoJSON.FeatureCollection,
          promoteId: "name",
        });
        // One label anchor per hood (a MultiPolygon otherwise gets a label on
        // every piece — piers, breakwaters — so Marina/North Beach repeated).
        map.addSource("hood-labels", { type: "geojson", data: hoodLabelPoints() });
        map.addLayer({
          id: "hoods-fill",
          type: "fill",
          source: "hoods",
          paint: {
            "fill-color": HOOD,
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.12,
              0.035,
            ],
          },
        });
        map.addLayer({
          id: "hoods-line-glow",
          type: "line",
          source: "hoods",
          paint: { "line-color": HOOD, "line-width": 4.5, "line-opacity": 0.1, "line-blur": 3 },
        });
        map.addLayer({
          id: "hoods-line",
          type: "line",
          source: "hoods",
          paint: { "line-color": HOOD, "line-width": 1, "line-opacity": 0.45 },
        });
        // Isolated-neighborhood outline: a bright high-contrast line with a soft
        // glow beneath. Both start hidden (filter → __none__) and are pulsed by
        // the isolate effect while a hood is selected.
        map.addLayer({
          id: "hood-selected-glow",
          type: "line",
          source: "hoods",
          filter: ["==", ["get", "name"], "__none__"],
          layout: { "line-join": "round" },
          paint: { "line-color": "#6bd0f0", "line-width": 6, "line-opacity": 0, "line-blur": 4 },
        });
        map.addLayer({
          id: "hood-selected-line",
          type: "line",
          source: "hoods",
          filter: ["==", ["get", "name"], "__none__"],
          layout: { "line-join": "round" },
          paint: { "line-color": "#c8f0ff", "line-width": 2.4, "line-opacity": 0 },
        });
        map.addLayer({
          id: "hoods-label",
          type: "symbol",
          source: "hood-labels",
          layout: {
            "text-field": ["upcase", ["get", "name"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 10.5, 9, 13, 12.5],
            "text-letter-spacing": 0.18,
            "text-max-width": 7,
          },
          paint: {
            "text-color": "#9fd8ef",
            "text-opacity": 0.8,
            "text-halo-color": PAPER,
            "text-halo-width": 1.4,
          },
        });

        // Scan targets: the real shortlisted listings, marked as static dots
        // during a search (the sweep itself is a CSS marker — see the sonar
        // effect — so there are zero per-frame map mutations).
        map.addSource("scan-targets", { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: "scan-target-dots",
          type: "circle",
          source: "scan-targets",
          layout: { visibility: "none" },
          paint: {
            "circle-color": ACCENT,
            "circle-radius": 3,
            "circle-opacity": 0.95,
            "circle-stroke-color": HALO,
            "circle-stroke-width": 1,
          },
        });

        // Listings
        map.addSource("listings", {
          type: "geojson",
          data: toGeoJson(listingsRef.current),
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 13,
          promoteId: "id",
        });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "listings",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": CLUSTER_COLOR_BROWSE,
            "circle-radius": ["step", ["get", "point_count"], 13, 10, 17, 40, 22],
            "circle-stroke-width": 1.25,
            "circle-stroke-color": "#46607a",
            "circle-opacity": 0.96,
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "listings",
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Noto Sans Bold"],
            "text-size": 11.5,
          },
          paint: { "text-color": "#e9eef5" },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "listings",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 5,
            "circle-stroke-width": 1.4,
            "circle-stroke-color": HALO,
            "circle-opacity": ["case", ["get", "approximate"], 0.5, 1],
          },
        });

        // Interactions
        map.on("click", "clusters", async (e) => {
          const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
          if (!feature) return;
          const source = map.getSource("listings") as GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(
            feature.properties!.cluster_id as number,
          );
          map.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoom + 0.4,
          });
        });
        map.on("click", "points", (e) => {
          const f = e.features?.[0];
          const id = f?.properties?.id as string | undefined;
          if (id) {
            spawnRipple(map, (f!.geometry as GeoJSON.Point).coordinates as [number, number]);
            onSelectRef.current(id);
          }
        });
        // A single map-level handler for neighborhoods so it also fires on the
        // black area outside SF (no hood-fill there). In city view a click
        // isolates the clicked hood; while a hood is isolated, a click anywhere
        // that isn't that hood (another hood, the plateau's surroundings, the
        // masked ocean) releases it. Listing hits are handled by their own
        // layers / the HTML thumbnail markers, so bail on those.
        map.on("click", (e) => {
          if (
            map.queryRenderedFeatures(e.point, { layers: ["points", "clusters"] }).length > 0
          ) {
            return;
          }
          const clicked = map.queryRenderedFeatures(e.point, { layers: ["hoods-fill"] })[0]
            ?.properties?.name as string | undefined;
          const sel = selectedHoodRef.current;
          if (sel) {
            if (clicked !== sel) onHoodSelectRef.current(null);
          } else if (clicked) {
            onHoodSelectRef.current(clicked);
          }
        });
        map.on("mousemove", "hoods-fill", (e) => {
          const name = e.features?.[0]?.properties?.name as string | undefined;
          if (hoveredHoodRef.current === name) return;
          if (hoveredHoodRef.current) {
            map.setFeatureState(
              { source: "hoods", id: hoveredHoodRef.current },
              { hover: false },
            );
          }
          hoveredHoodRef.current = name ?? null;
          if (name) map.setFeatureState({ source: "hoods", id: name }, { hover: true });
        });
        map.on("mouseleave", "hoods-fill", () => {
          if (hoveredHoodRef.current) {
            map.setFeatureState(
              { source: "hoods", id: hoveredHoodRef.current },
              { hover: false },
            );
            hoveredHoodRef.current = null;
          }
        });
        for (const layer of ["clusters", "points"]) {
          map.on("mouseenter", layer, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            map.getCanvas().style.cursor = "";
          });
        }
        map.on("moveend", () => refreshThumbsRef.current());
        map.on("zoomend", () => refreshThumbsRef.current());

        loadedRef.current = true;
        map.resize();
        syncData(map, listingsRef.current);
        refreshThumbsRef.current();

        const intro = { center: SF_CENTER as [number, number], zoom: 12.4, pitch: 0, bearing: 0 };
        if (reduced || document.visibilityState === "hidden") {
          map.jumpTo(intro);
        } else {
          map.flyTo({ ...intro, duration: 1400, curve: 1.2 });
          window.setTimeout(() => {
            if (mapRef.current === map && map.isMoving() && map.getZoom() < 12) {
              map.stop();
              map.jumpTo(intro);
            }
          }, 4200);
        }
      });

      const ro = new ResizeObserver(() => map.resize());
      ro.observe(container);
      cleanupRef.current = () => {
        ro.disconnect();
        lockMarkerRef.current?.remove();
        for (const m of thumbsRef.current.values()) m.remove();
        thumbsRef.current.clear();
        map.remove();
        mapRef.current = null;
        loadedRef.current = false;
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
     
  }, []);

  // Push listing changes into the source + thumbnails.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    syncData(map, listings);
    refreshThumbsRef.current();
  }, [listings]);

  /* ---------- Search: highlight matching listings on the map ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    try {
      map.setLayoutProperty("scan-target-dots", "visibility", searching ? "visible" : "none");
      if (!searching) {
        (map.getSource("scan-targets") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      }
    } catch {
      /* layers may not exist yet */
    }
  }, [searching]);

  // As the shortlist streams in, mark the real candidates and gently frame them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !searching) return;
    const coords = (scanIds ?? [])
      .map((id) => radarPoints?.find((p) => p.id === id))
      .filter((p): p is RadarPoint => p != null)
      .map((p) => [p.lng, p.lat] as [number, number]);
    if (coords.length === 0) return;

    try {
      (map.getSource("scan-targets") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: coords.map((c) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: c },
        })),
      });
    } catch {
      return;
    }

    if (!prefersReducedMotion() && document.visibilityState !== "hidden") {
      const bounds = new maplibregl.LngLatBounds();
      for (const c of coords) bounds.extend(c);
      if (!bounds.isEmpty()) {
        const cam = map.cameraForBounds(bounds, {
          padding: { top: 110, left: 90, right: 90, bottom: 120 },
          maxZoom: 13.4,
        });
        if (cam) map.easeTo({ ...cam, duration: 1300 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanIds, searching]);

  /* ---------- Neighborhood isolate: highlight the hood + show terrain ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    selectedHoodRef.current = selectedHood;
    const reduced = prefersReducedMotion();
    const motionOk = !reduced && document.visibilityState !== "hidden";
    const hood = hoodByName(selectedHood);

    // Toggle the hood-mode layer set: satellite reveal + real terrain on, browse
    // dots off (the hood's listings show as pills), and a bright highlighted
    // outline tracing the neighborhood.
    const applyLayers = (activeHood: string | null) => {
      const hoodFilter = ["==", ["get", "name"], activeHood ?? "__none__"] as never;
      map.setFilter("hood-selected-line", hoodFilter);
      map.setFilter("hood-selected-glow", hoodFilter);
      map.setPaintProperty("hood-selected-line", "line-opacity", activeHood ? 0.95 : 0);
      map.setPaintProperty("hood-selected-glow", "line-opacity", activeHood ? 0.6 : 0);
      (map.getSource("hood-reveal") as GeoJSONSource | undefined)?.setData(hoodRevealMask(activeHood));
      map.setLayoutProperty("hood-satellite", "visibility", activeHood ? "visible" : "none");
      map.setLayoutProperty("hood-reveal-mask", "visibility", activeHood ? "visible" : "none");
      map.setPaintProperty("hoods-line", "line-opacity", activeHood ? 0.22 : 0.45);
      map.setPaintProperty("hoods-label", "text-opacity", activeHood ? 0.5 : 0.8);
      const dotVis = activeHood ? "none" : "visible";
      for (const id of ["points", "clusters", "cluster-count"]) {
        map.setLayoutProperty(id, "visibility", dotVis);
      }
    };

    try {
      if (selectedHood) {
        // Reveal the neighborhood with its satellite imagery + real terrain
        // relief, and highlight it. No lift — the terrain is genuine elevation.
        applyLayers(selectedHood);
        enableTerrain(map);
        refreshThumbsRef.current();
        if (motionOk) void preloadHoodSatellite(selectedHood);
      } else {
        applyLayers(null);
        removeTerrain(map);
        refreshThumbsRef.current();
      }
    } catch {
      return;
    }

    // Camera: swoop into the hood at a three-quarter angle, or back to the flat city.
    if (selectedHood && hood) {
      const [[w, s], [e, n]] = multiPolygonBounds(hood.geometry.coordinates);
      const cam = map.cameraForBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: { top: 240, left: 120, right: 120, bottom: 160 }, bearing: -20, maxZoom: 14.2 },
      );
      if (cam) {
        if (!motionOk) map.jumpTo({ ...cam, pitch: 62 });
        else map.flyTo({ ...cam, pitch: 62, duration: 2000, curve: 1.4 });
      }
    } else if (!selectedHood && !searchActiveRef.current) {
      const home = { center: SF_CENTER as [number, number], zoom: 12.4, pitch: 0, bearing: 0 };
      if (!motionOk) map.jumpTo(home);
      else map.flyTo({ ...home, duration: 1300, curve: 1.3 });
    }
  }, [selectedHood]);

  /* ---------- Target mode (search results) ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    searchActiveRef.current = !!searchActive;

    try {
      map.setPaintProperty(
        "points",
        "circle-color",
        searchActive ? ACCENT : (["get", "color"] as unknown as maplibregl.ExpressionSpecification),
      );
      map.setPaintProperty("points", "circle-radius", searchActive ? 6 : 5);
      map.setPaintProperty(
        "clusters",
        "circle-color",
        searchActive ? ACCENT : CLUSTER_COLOR_BROWSE,
      );
    } catch {
      return;
    }
    refreshThumbsRef.current(); // matches switch to accent pills / plain pills

    if (searchActive && !selectedHoodRef.current) {
      const pts = listings.filter((l) => l.latitude != null && l.longitude != null);
      if (pts.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const l of pts) {
          if (l.latitude! > 37.6 && l.latitude! < 37.85 && l.longitude! > -122.56 && l.longitude! < -122.3) {
            bounds.extend([l.longitude!, l.latitude!]);
          }
        }
        if (!bounds.isEmpty()) {
          const cam = map.cameraForBounds(bounds, {
            padding: { top: 150, left: 90, right: 90, bottom: 90 },
            maxZoom: pts.length === 1 ? 15.6 : 14.4,
          });
          if (cam) {
            if (prefersReducedMotion() || document.visibilityState === "hidden") {
              map.jumpTo(cam);
            } else {
              map.easeTo({ ...cam, duration: 1200 });
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, searchActive ? listings : null]);

  /* ---------- Selection: photo card on the selected listing ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    lockMarkerRef.current?.remove();
    lockMarkerRef.current = null;
    refreshThumbsRef.current(); // drop the selected listing's pill; restore others

    if (selectedId) {
      const listing = listings.find((l) => l.id === selectedId);
      if (listing?.latitude != null && listing.longitude != null) {
        lockMarkerRef.current = new maplibregl.Marker({
          element: makePhotoCardElement(listing, () => onSelectRef.current(listing.id)),
          anchor: "bottom",
          offset: [0, -8],
        })
          .setLngLat([listing.longitude, listing.latitude])
          .addTo(map);
        const target = {
          center: [listing.longitude, listing.latitude] as [number, number],
          zoom: Math.max(map.getZoom(), 14.6),
        };
        if (prefersReducedMotion() || document.visibilityState === "hidden") map.jumpTo(target);
        else map.easeTo({ ...target, duration: 650 });
      }
    }
  }, [selectedId, listings]);

  return (
    <div className="relative h-full w-full bg-paper">
      <div ref={containerRef} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "linear-gradient(to bottom, rgba(6,9,15,0.45), rgba(6,9,15,0))" }}
      />
      <div className="pointer-events-none absolute bottom-4 left-3 z-10 flex items-center gap-3 rounded-md border border-line bg-surface/90 px-3 py-1.5 text-[11px] shadow-md backdrop-blur-sm max-sm:hidden">
        {LEGEND.map(([color, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-muted">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function spawnRipple(map: maplibregl.Map, lngLat: [number, number]) {
  const marker = new maplibregl.Marker({ element: makeRippleElement() })
    .setLngLat(lngLat)
    .addTo(map);
  window.setTimeout(() => marker.remove(), 520);
}

function syncData(map: maplibregl.Map, listings: ListingSummary[]) {
  const source = map.getSource("listings") as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(toGeoJson(listings));
}
