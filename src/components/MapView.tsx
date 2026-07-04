"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import type { ListingSummary } from "@/lib/api-types";
import { DEFAULT_MARKER_COLOR } from "@/lib/badges";
import { fmtMoneyShort } from "@/lib/format";
import { multiPolygonBounds, type MultiPolygonCoords } from "@/lib/geo";
import { neighborhoodCentroid } from "@/core/neighborhoods";
import hoodsData from "@/data/sf-neighborhoods.json";
import outsideSfMaskData from "@/data/sf-outside-mask.json";

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
/** Resting tilt of the browse map — a dramatic three-quarter view of the city,
 * clearly a 3D scene rather than a top-down plan. */
const BROWSE_PITCH = 47;
/** Idle zoom that frames the whole tilted city with sky above it. */
const BROWSE_ZOOM = 11.7;

// Clusters are aggregates of mixed status → neutral steel, denser = lighter.
const CLUSTER_COLOR_BROWSE = [
  "step", ["get", "point_count"],
  "#1b2634", 10, "#25334a", 40, "#31445c",
] as unknown as maplibregl.ExpressionSpecification;

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

/** Bounding box of every neighborhood = the city extent, used to frame the
 * resting "home" view so the whole city fits whatever width the map viewport
 * has (it lives left of the results rail, so that width varies). */
const CITY_BOUNDS: [[number, number], [number, number]] = (() => {
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (const f of HOODS) {
    const [[fw, fs], [fe, fn]] = multiPolygonBounds(f.geometry.coordinates);
    w = Math.min(w, fw);
    s = Math.min(s, fs);
    e = Math.max(e, fe);
    n = Math.max(n, fn);
  }
  return [
    [w, s],
    [e, n],
  ];
})();

/** Camera that frames the whole city in the current viewport at the browse tilt. */
function cityCamera(map: maplibregl.Map) {
  const cam = map.cameraForBounds(CITY_BOUNDS, {
    padding: { top: 16, bottom: 14, left: 16, right: 16 },
    bearing: 0,
  });
  if (!cam || cam.zoom == null || !cam.center) {
    return { center: SF_CENTER, zoom: BROWSE_ZOOM, pitch: BROWSE_PITCH, bearing: 0 };
  }
  // Pitching shows more than the flat fit, so ease the zoom back a hair to keep
  // the whole city comfortably in frame with sky above it.
  return { center: cam.center, zoom: cam.zoom - 0.1, pitch: BROWSE_PITCH, bearing: 0 };
}

const WORLD_RING: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/**
 * "Everything outside San Francisco" as a single clean MultiPolygon —
 * precomputed offline (a Bay-Area box MINUS every neighborhood, dissolved with
 * a real polygon-boolean) so overlaps/winding are resolved. Drawn opaque, it
 * hides all non-SF content with no seams inside SF. See scripts/build-sf-boundary.ts.
 */
function outsideSfMask(): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: outsideSfMaskData as GeoJSON.MultiPolygon,
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

/**
 * The "reveal a neighborhood" layer treatment — satellite imagery + a
 * hole-punched dim mask, a bright highlighted outline, and dimmed browse dots.
 * Shared by both ways a hood gets shown this way: clicking it directly
 * (isolate) and a search that names it (highlight) — so a search reveals the
 * neighborhood exactly like a click does, not just an outline.
 */
function applyHoodRevealLayers(map: maplibregl.Map, activeHood: string | null) {
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
  // Browse-mode GL dots off while a hood is revealed — irrelevant during an
  // active search anyway, since search results render as HTML thumb markers
  // (see refreshThumbs), not this layer.
  const dotVis = activeHood ? "none" : "visible";
  for (const id of ["points", "clusters", "cluster-count"]) {
    map.setLayoutProperty(id, "visibility", dotVis);
  }
  // Constrain 3D buildings to the revealed neighborhood's own footprint.
  // Without this, buildings extrude for the WHOLE viewport at this zoom —
  // so a revealed hood's tilted camera also lit up buildings in neighboring,
  // non-highlighted neighborhoods (e.g. SoMa behind a highlighted Downtown).
  if (map.getLayer("apt-3d-buildings")) {
    const hood = activeHood ? hoodByName(activeHood) : undefined;
    map.setFilter(
      "apt-3d-buildings",
      hood ? (["within", hood.geometry] as unknown as maplibregl.FilterSpecification) : null,
    );
  }
}

/** Recolor the light Positron style into the navy ops palette before boot.
 * Deliberately NOT monochrome: water reads blue, parks read green, buildings
 * sit warmer than the land, and major roads run brighter than minor ones, so
 * the city has tonal depth even though every hue stays in the dark family. */
function darkenStyle(style: StyleSpecification): StyleSpecification {
  const TEXT = "#8ba3c2";
  const TEXT_MINOR = "#5f7492";
  for (const layer of style.layers ?? []) {
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    const id = layer.id.toLowerCase();
    if (layer.type === "background") {
      paint["background-color"] = PAPER;
    } else if (layer.type === "fill") {
      if (id.includes("water")) paint["fill-color"] = "#0e2338"; // deep saturated blue
      else if (id.includes("green") || id.includes("park") || id.includes("wood") || id.includes("grass"))
        paint["fill-color"] = "#12241c"; // quiet green
      else if (id.includes("sand") || id.includes("beach"))
        paint["fill-color"] = "#20222a";
      else if (id.includes("building")) paint["fill-color"] = "#1b2536"; // warm slate, lifted off the land
      else paint["fill-color"] = "#0b1526";
      delete paint["fill-outline-color"];
    } else if (layer.type === "line") {
      if (id.includes("water")) paint["line-color"] = "#17304a";
      else if (id.includes("casing")) paint["line-color"] = "#101d31";
      else if (id.includes("boundary") || id.includes("admin")) paint["line-color"] = "#2a3d5c";
      else if (id.includes("rail") || id.includes("transit")) paint["line-color"] = "#26303f";
      else if (id.includes("major") || id.includes("motorway") || id.includes("trunk") || id.includes("primary"))
        paint["line-color"] = "#33475f"; // arterials pop a step brighter
      else if (id.includes("minor") || id.includes("service") || id.includes("path"))
        paint["line-color"] = "#1d2d45";
      else paint["line-color"] = "#25374f";
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
  el.className = `price-pill${active ? " pill-active" : ""}`;
  el.textContent = fmtMoneyShort(l.priceEffectiveMonthly ?? l.priceMonthly) ?? "—";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return withRoot(el);
}

/** A photo card marker — for the selected listing and for the hover preview
 * that a price pill expands into. Shows the photo, price, beds·baths·sqft, and
 * (when a search is active) the AI fit line. */
function makePhotoCardElement(
  l: ListingSummary,
  opts: { reason?: string | null; expand?: boolean; onClick: () => void },
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = opts.expand ? "photo-card photo-card-expand" : "photo-card";
  const frame = document.createElement("div");
  frame.className = "photo-card-frame";
  if (l.primaryPhotoUrl) {
    const img = document.createElement("img");
    img.className = "photo-card-img";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 210;
    img.height = 112;
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
  const metaParts: string[] = [];
  const beds = bedsShort(l);
  if (beds) metaParts.push(beds);
  if (l.bathrooms != null) metaParts.push(`${l.bathrooms} ba`);
  if (l.squareFeet) metaParts.push(`${l.squareFeet.toLocaleString()} sqft`);
  if (metaParts.length) {
    const meta = document.createElement("span");
    meta.className = "photo-card-meta";
    meta.textContent = metaParts.join(" · ");
    bar.appendChild(meta);
  }
  frame.appendChild(bar);
  if (opts.reason) {
    const reason = document.createElement("div");
    reason.className = "photo-card-reason";
    reason.textContent = opts.reason;
    frame.appendChild(reason);
  }
  el.appendChild(frame);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onClick();
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
          color: DEFAULT_MARKER_COLOR,
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
  reasons,
  searching,
  searchActive,
  selectedHood,
  onHoodSelect,
  highlightHood,
  searchToken,
  scanIds,
  radarPoints,
}: {
  listings: ListingSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** id → AI match info (score + one-line reason) for the on-map cards */
  reasons?: Map<string, { score: number; reason: string }>;
  searching?: boolean;
  searchActive?: boolean;
  selectedHood: string | null;
  onHoodSelect: (name: string | null) => void;
  /** a neighborhood named by the search — highlighted (outline only, no isolate) */
  highlightHood?: string | null;
  /** bumped once per search ATTEMPT — lets the camera effects tell "a new
   * search landed" apart from "the current results just got filtered down"
   * (hide / thumbs-down), even when the new search repeats the same
   * neighborhood name or an overlapping result set. */
  searchToken?: number;
  /** the actual shortlisted listing ids streamed mid-search */
  scanIds?: string[] | null;
  /** id → coords for every active listing */
  radarPoints?: RadarPoint[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  // Flips true once the map's `load` fires. Threaded into the camera/layer
  // effects so that a search fired DURING boot (before they could run) is
  // applied as soon as the map is ready, instead of being stranded at home.
  const [mapLoaded, setMapLoaded] = useState(false);
  const listingsRef = useRef(listings);
  const onSelectRef = useRef(onSelect);
  const onHoodSelectRef = useRef(onHoodSelect);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectedHoodRef = useRef<string | null>(null);
  const highlightHoodRef = useRef<string | null>(null);
  const hoveredHoodRef = useRef<string | null>(null);
  const lockMarkerRef = useRef<maplibregl.Marker | null>(null);
  const thumbsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const searchActiveRef = useRef(false);
  // The searchToken the camera was last framed for. A status toggle (hide /
  // thumbs-down) only shrinks the current results without bumping the token,
  // so it never re-frames (that's the "map zooms when I thumbs-down a result"
  // bug); a genuinely new search always carries a fresh token, so it always
  // re-frames — even if it repeats the same neighborhood name or lands a
  // result set that overlaps the previous one.
  const framedSearchTokenRef = useRef<number | null | undefined>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const refreshThumbsRef = useRef<() => void>(() => {});
  const reasonsRef = useRef(reasons);
  // Hover preview: a price pill expands into a photo card while hovered.
  const hoverCardRef = useRef<maplibregl.Marker | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const setPillOpacity = (id: string | null, v: string) => {
    if (!id) return;
    const inner = thumbsRef.current.get(id)?.getElement().firstElementChild as HTMLElement | undefined;
    if (inner) inner.style.opacity = v;
  };
  const hideHoverCard = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverCardRef.current?.remove();
    hoverCardRef.current = null;
    setPillOpacity(hoverIdRef.current, "");
    hoverIdRef.current = null;
  };
  const scheduleHideHoverCard = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(hideHoverCard, 90);
  };
  const cancelHideHoverCard = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };
  const showHoverCard = (l: ListingSummary) => {
    const map = mapRef.current;
    if (!map || l.latitude == null || l.longitude == null) return;
    if (selectedIdRef.current === l.id) return; // already shown as the locked card
    if (hoverIdRef.current === l.id) {
      cancelHideHoverCard();
      return;
    }
    hideHoverCard();
    const el = makePhotoCardElement(l, {
      reason: reasonsRef.current?.get(l.id)?.reason ?? null,
      expand: true,
      onClick: () => {
        spawnRipple(map, [l.longitude!, l.latitude!]);
        onSelectRef.current(l.id);
      },
    });
    el.addEventListener("mouseenter", cancelHideHoverCard);
    el.addEventListener("mouseleave", scheduleHideHoverCard);
    hoverCardRef.current = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -12] })
      .setLngLat([l.longitude, l.latitude])
      .addTo(map);
    hoverIdRef.current = l.id;
    setPillOpacity(l.id, "0"); // hide the pill so the card reads as its expansion
  };

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
        el.addEventListener("mouseenter", () => showHoverCard(l));
        el.addEventListener("mouseleave", scheduleHideHoverCard);
        marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([l.longitude!, l.latitude!])
          .addTo(map);
        thumbs.set(l.id, marker);
      }
    }
    // If the hovered pill just left the viewport, drop its card.
    if (hoverIdRef.current && !wantedIds.has(hoverIdRef.current)) hideHoverCard();
  };
  useEffect(() => {
    listingsRef.current = listings;
    onSelectRef.current = onSelect;
    onHoodSelectRef.current = onHoodSelect;
    selectedIdRef.current = selectedId;
    reasonsRef.current = reasons;
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
        pitch: BROWSE_PITCH,
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

        // SF-only mask — fully opaque so NOTHING outside San Francisco shows
        // (no streets, labels, buildings, or terrain relief). Moved above the
        // base map, hillshade and buildings at the end of load so it truly
        // covers them; only the SF hoods (its holes) remain visible.
        map.addSource("outside-sf", { type: "geojson", data: outsideSfMask() });
        map.addLayer({
          id: "outside-sf-mask",
          type: "fill",
          source: "outside-sf",
          paint: { "fill-color": PAPER, "fill-opacity": 1 },
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
          // Fully opaque: the satellite raster is a single GLOBAL layer, so the
          // ONLY thing keeping it inside the selected hood is this hole-punched
          // cover. Any translucency lets satellite bleed over the whole city —
          // most visibly during the fly-in — so it must be 1, not 0.9. The hood
          // (the hole) is the sole place imagery shows; everywhere else stays the
          // dark paper with just the neighborhood outlines/labels floating above.
          paint: { "fill-color": PAPER, "fill-opacity": 1 },
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
              // Held off until well past where clusters break into individual
              // pins (zoom 13) — at that zoom buildings were popping in as a
              // messy field right as the map was still busy revealing pins.
              // Now they only extrude once you're properly zoomed into a
              // neighborhood (isolate/highlight land around 14-14.2).
              minzoom: 14,
              paint: {
                "fill-extrusion-color": "#243349",
                "fill-extrusion-height": [
                  "interpolate", ["linear"], ["zoom"],
                  14, 0,
                  14.6, ["coalesce", ["get", "render_height"], 10],
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

        // Lift the SF mask above the base map, buildings, satellite and terrain
        // (but below the hood outlines/labels/markers) so nothing outside SF —
        // streets, labels, buildings, hillshade — is ever visible.
        try {
          map.moveLayer("outside-sf-mask", "hoods-fill");
        } catch (err) {
          console.warn("[apt map] mask reorder failed", err);
        }

        loadedRef.current = true;
        setMapLoaded(true);
        map.resize();
        syncData(map, listingsRef.current);
        refreshThumbsRef.current();

        const intro = cityCamera(map);
        if (reduced || document.visibilityState === "hidden") {
          map.jumpTo(intro);
        } else {
          map.flyTo({ ...intro, duration: 1500, curve: 1.2 });
          window.setTimeout(() => {
            // Only rescue a stuck intro — never yank the camera back if a
            // search, highlight, or isolate has since taken it somewhere.
            if (
              mapRef.current === map &&
              map.isMoving() &&
              !searchActiveRef.current &&
              !highlightHoodRef.current &&
              !selectedHoodRef.current
            ) {
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
        hoverCardRef.current?.remove();
        if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
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
  }, [listings, mapLoaded]);

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
  }, [searching, mapLoaded]);

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

    // When the search named a neighborhood, the highlight effect owns the
    // camera (centered + tilted on that hood) — don't tug it toward the pins.
    if (!highlightHoodRef.current && !prefersReducedMotion() && document.visibilityState !== "hidden") {
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
  }, [scanIds, searching, mapLoaded]);

  /* ---------- Neighborhood isolate: highlight the hood + show terrain ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    selectedHoodRef.current = selectedHood;
    const reduced = prefersReducedMotion();
    const motionOk = !reduced && document.visibilityState !== "hidden";
    const hood = hoodByName(selectedHood);

    try {
      if (selectedHood) {
        // Reveal the neighborhood with its satellite imagery + real terrain
        // relief, and highlight it. No lift — the terrain is genuine elevation.
        applyHoodRevealLayers(map, selectedHood);
        enableTerrain(map);
        refreshThumbsRef.current();
        if (motionOk) void preloadHoodSatellite(selectedHood);
      } else {
        applyHoodRevealLayers(map, null);
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
    } else if (!selectedHood && !searchActiveRef.current && !highlightHoodRef.current) {
      const home = cityCamera(map);
      if (!motionOk) map.jumpTo(home);
      else map.flyTo({ ...home, duration: 1300, curve: 1.3 });
    }
  }, [selectedHood, mapLoaded]);

  /* --- Search highlight: a neighborhood named in the query gets the FULL
   * reveal — centered, tilted, outlined, and shown with satellite imagery +
   * real terrain relief — the same "here's your neighborhood" gesture as
   * clicking it directly (isolate). Search results still read on top: they
   * render as HTML thumb markers regardless of this hood reveal, not the
   * browse-mode GL dots this hides. --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const prev = highlightHoodRef.current;
    highlightHoodRef.current = highlightHood ?? null;
    // A full isolate owns the reveal + terrain; don't fight it.
    if (selectedHood) return;
    const name = highlightHood ?? null;
    const hood = hoodByName(name);
    const motionOk = !prefersReducedMotion() && document.visibilityState !== "hidden";
    try {
      // The satellite/dim reveal only makes sense when the name is an actual
      // map polygon (37 of them) — there's no boundary to cut a satellite hole
      // around otherwise. Many searchable sub-neighborhoods (Hayes Valley,
      // Japantown, the Tenderloin…) aren't polygons; those still center + tilt
      // + show terrain via their centroid below, just without the reveal.
      applyHoodRevealLayers(map, hood ? name : null);
      map.setPaintProperty("hoods-label", "text-opacity", name ? 0.9 : 0.8);

      if (name) {
        enableTerrain(map);
        refreshThumbsRef.current();
        if (motionOk) void preloadHoodSatellite(name);
        const applyCam = (t: maplibregl.CameraOptions) => {
          if (!motionOk) map.jumpTo(t);
          else map.flyTo({ ...t, duration: 1600, curve: 1.5 });
        };
        // Prefer the polygon's bounds; fall back to the neighborhood centroid.
        if (hood) {
          const [[w, s], [e, n]] = multiPolygonBounds(hood.geometry.coordinates);
          const cam = map.cameraForBounds(
            [
              [w, s],
              [e, n],
            ],
            { padding: { top: 150, left: 120, right: 120, bottom: 130 }, bearing: 0, maxZoom: 14 },
          );
          if (cam) applyCam({ ...cam, pitch: 54 });
        } else {
          const c = neighborhoodCentroid(name);
          if (c) applyCam({ center: [c.lng, c.lat], zoom: 14, pitch: 54, bearing: 0 });
        }
      } else if (prev) {
        // Cleared the highlight: drop terrain (camera home is handled on search clear).
        removeTerrain(map);
        refreshThumbsRef.current();
      }
    } catch {
      /* layers not ready yet */
    }
    // searchToken forces this to re-apply even when highlightHood repeats the
    // same neighborhood as the previous search (e.g. two Mission searches in a
    // row) — otherwise the camera wouldn't return if the user had since panned
    // away, since none of the other dependencies would have changed.
  }, [highlightHood, selectedHood, mapLoaded, searchToken]);

  /* ---------- Target mode (search results) ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const wasActive = searchActiveRef.current;
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

    // A named neighborhood is framed + tilted by the highlight effect; only
    // frame the camera here for scattered, citywide results.
    if (searchActive && !selectedHoodRef.current && !highlightHoodRef.current) {
      const pts = listings.filter((l) => l.latitude != null && l.longitude != null);
      // Only re-frame for a genuinely NEW search (a fresh token) — a status
      // change that merely shrinks the current results (hide / thumbs-down)
      // doesn't bump the token, so the camera holds still for those.
      const isNewSearch = framedSearchTokenRef.current !== searchToken;
      if (pts.length > 0 && isNewSearch) {
        framedSearchTokenRef.current = searchToken;
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
            // Flatten a touch so scattered pins across the city stay readable.
            const target = { ...cam, pitch: 22 };
            if (prefersReducedMotion() || document.visibilityState === "hidden") {
              map.jumpTo(target);
            } else {
              map.easeTo({ ...target, duration: 1200 });
            }
          }
        }
      }
    } else if (!searchActive && wasActive && !selectedHoodRef.current && !highlightHoodRef.current) {
      // Clearing a search glides back to the resting city view.
      const home = { center: SF_CENTER as [number, number], zoom: BROWSE_ZOOM, pitch: BROWSE_PITCH, bearing: 0 };
      if (prefersReducedMotion() || document.visibilityState === "hidden") map.jumpTo(home);
      else map.flyTo({ ...home, duration: 1200, curve: 1.3 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, searchActive ? listings : null, mapLoaded, searchToken]);

  /* ---------- Selection: photo card on the selected listing ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    hideHoverCard();
    lockMarkerRef.current?.remove();
    lockMarkerRef.current = null;
    refreshThumbsRef.current(); // drop the selected listing's pill; restore others

    if (selectedId) {
      const listing = listings.find((l) => l.id === selectedId);
      if (listing?.latitude != null && listing.longitude != null) {
        lockMarkerRef.current = new maplibregl.Marker({
          element: makePhotoCardElement(listing, {
            reason: reasonsRef.current?.get(listing.id)?.reason ?? null,
            onClick: () => onSelectRef.current(listing.id),
          }),
          anchor: "bottom",
          offset: [0, -8],
        })
          .setLngLat([listing.longitude, listing.latitude])
          .addTo(map);
        // Clicking a listing swoops in: more tilt, a slight rotation, closer zoom.
        const target = {
          center: [listing.longitude, listing.latitude] as [number, number],
          zoom: Math.max(map.getZoom() + 0.8, 15.4),
          pitch: 58,
          bearing: -13,
        };
        if (prefersReducedMotion() || document.visibilityState === "hidden") map.jumpTo(target);
        else map.easeTo({ ...target, duration: 720 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, listings, mapLoaded]);

  return (
    <div className="relative h-full w-full bg-paper">
      <div ref={containerRef} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "linear-gradient(to bottom, rgba(6,9,15,0.45), rgba(6,9,15,0))" }}
      />
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
