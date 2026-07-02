"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import type { ListingSummary } from "@/lib/api-types";
import { BADGE_COLORS, DEFAULT_MARKER_COLOR, markerColor } from "@/lib/badges";
import { fmtMoneyShort } from "@/lib/format";
import { multiPolygonBounds, pointInMultiPolygon, type MultiPolygonCoords } from "@/lib/geo";
import hoodsData from "@/data/sf-neighborhoods.json";

/**
 * The Navy-ops 3D stage.
 *
 * - Dark navy basemap (Positron recolored at runtime); ONLY San Francisco is
 *   visible — the rest of the world is masked and the camera is hard-bounded.
 * - Real terrain (AWS terrarium DEM) + extruded buildings.
 * - The 37 official planning neighborhoods render as glowing HUD polygons.
 *   Clicking one LIFTS it out of the map: a solid slab rises carrying the
 *   actual buildings inside the boundary (a `within` filter splits the
 *   building layer), revealing satellite imagery in the crater below, while
 *   photo thumbnails of that hood's listings hover above the slab.
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
const ACCENT = "#ff6b3d";
const HOOD = "#3fd0ff";
const HOOD_BRIGHT = "#7ce4ff";
const HALO = "#081120";
/** How far a selected neighborhood is raised out of the map (baked into the DEM). */
const HOOD_BOOST_M = 240;
const TERRAIN_EXAGGERATION = 1.3;

const CLUSTER_COLOR_BROWSE = [
  "step", ["get", "point_count"],
  "#33475f", 10, "#4a6076", 40, "#ff6b3d",
] as unknown as maplibregl.ExpressionSpecification;

const LEGEND: Array<[string, string]> = [
  [BADGE_COLORS.new_today, "New"],
  [BADGE_COLORS.price_drop, "Drop"],
  [BADGE_COLORS.verify_carefully, "Verify"],
  [BADGE_COLORS.saved, "Saved"],
  [DEFAULT_MARKER_COLOR, "Listing"],
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

/* ---------- Custom DEM: physically raise the selected neighborhood ----------
 * The diorama effect. `aptdem://<hood>/{z}/{x}/{y}.png` proxies the public
 * terrarium elevation tiles and re-encodes every pixel inside the hood polygon
 * with +HOOD_BOOST_M meters. Terrain is rebuilt from this source on selection,
 * so the ENTIRE neighborhood — satellite imagery, streets, buildings, markers —
 * drapes up onto a raised plateau with sheer texture-stretched cliff sides,
 * while the rest of the city stays at true elevation. `none` passes through.
 */
const TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium";
const demTileCache = new Map<string, ArrayBuffer>();
let demProtocolRegistered = false;

function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function registerDemProtocol() {
  if (demProtocolRegistered) return;
  demProtocolRegistered = true;
  maplibregl.addProtocol("aptdem", async (params) => {
    const m = /^aptdem:\/\/([^/]*)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(params.url);
    if (!m) throw new Error(`bad aptdem url: ${params.url}`);
    const cached = demTileCache.get(params.url);
    if (cached) return { data: cached };
    const hoodName = decodeURIComponent(m[1]);
    const z = Number(m[2]);
    const x = Number(m[3]);
    const y = Number(m[4]);

    const res = await fetch(`${TERRARIUM_URL}/${z}/${x}/${y}.png`);
    if (!res.ok) throw new Error(`dem tile ${res.status}`);
    const buf = await res.arrayBuffer();

    const hood = hoodName === "none" ? undefined : hoodByName(hoodName);
    if (!hood) {
      demTileCache.set(params.url, buf);
      return { data: buf };
    }
    // Skip tiles that don't overlap the hood at all.
    const n = 2 ** z;
    const lngW = (x / n) * 360 - 180;
    const lngE = ((x + 1) / n) * 360 - 180;
    const latN = tile2lat(y, z);
    const latS = tile2lat(y + 1, z);
    const [[bw, bs], [be, bn]] = multiPolygonBounds(hood.geometry.coordinates);
    if (lngE < bw || lngW > be || latN < bs || latS > bn) {
      demTileCache.set(params.url, buf);
      return { data: buf };
    }

    const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, 256, 256);
    const img = ctx.getImageData(0, 0, 256, 256);
    const d = img.data;
    for (let py = 0; py < 256; py++) {
      const lat = tile2lat(y + py / 256, z);
      if (lat < bs || lat > bn) continue;
      for (let px = 0; px < 256; px++) {
        const lng = ((x + px / 256) / n) * 360 - 180;
        if (lng < bw || lng > be) continue;
        if (!pointInMultiPolygon(lng, lat, hood.geometry.coordinates)) continue;
        const i = (py * 256 + px) * 4;
        // terrarium: elevation = R*256 + G + B/256 - 32768
        const raw = d[i] * 256 + d[i + 1] + d[i + 2] / 256 + HOOD_BOOST_M;
        const whole = Math.floor(raw);
        d[i] = (whole >> 8) & 255;
        d[i + 1] = whole & 255;
        d[i + 2] = Math.round((raw - whole) * 256) & 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("dem re-encode failed");
    const out = await blob.arrayBuffer();
    demTileCache.set(params.url, out);
    return { data: out };
  });
}

function demTilesUrl(hoodName: string | null): string {
  return `aptdem://${encodeURIComponent(hoodName ?? "none")}/{z}/{x}/{y}.png`;
}

const HILLSHADE_PAINT: Record<string, unknown> = {
  "hillshade-shadow-color": "#020710",
  "hillshade-highlight-color": "#4a6d94",
  "hillshade-accent-color": "#0b1c30",
  "hillshade-exaggeration": 0.55,
};

/**
 * (Re)build terrain + hillshade from the boosted DEM for the given hood.
 * The dependent hillshade layers must come down before the source can.
 */
function swapTerrain(map: maplibregl.Map, hoodName: string | null) {
  try {
    map.setTerrain(null);
    for (const lid of ["hillshade-top", "hillshade-base"]) {
      if (map.getLayer(lid)) map.removeLayer(lid);
    }
    if (map.getSource("dem")) map.removeSource("dem");
    map.addSource("dem", {
      type: "raster-dem",
      tiles: [demTilesUrl(hoodName)],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 13,
      attribution: "Terrain: Mapzen/AWS",
    });
    // Citywide sculpted relief, under the outside-SF mask.
    map.addLayer(
      { id: "hillshade-base", type: "hillshade", source: "dem", paint: HILLSHADE_PAINT as never },
      "outside-sf-mask",
    );
    // Relief on the lifted plateau's satellite imagery (hood mode only).
    map.addLayer(
      {
        id: "hillshade-top",
        type: "hillshade",
        source: "dem",
        layout: { visibility: hoodName ? "visible" : "none" },
        paint: HILLSHADE_PAINT as never,
      },
      "hood-reveal-mask",
    );
    map.setTerrain({ source: "dem", exaggeration: TERRAIN_EXAGGERATION });
  } catch (err) {
    console.warn("[apt map] terrain swap failed", err);
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

function makeBracketElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-lock";
  el.innerHTML = `
    <svg viewBox="0 0 48 48" width="48" height="48" style="display:block">
      <g stroke="${ACCENT}" stroke-width="2.4" fill="none" stroke-linecap="round">
        <path d="M6,16 L6,6 L16,6" /><path d="M32,6 L42,6 L42,16" />
        <path d="M42,32 L42,42 L32,42" /><path d="M16,42 L6,42 L6,32" />
      </g>
      <circle cx="24" cy="24" r="7.5" fill="none" stroke="${ACCENT}" stroke-width="1.6" class="radar-reticle-pulse" />
    </svg>`;
  return withRoot(el);
}

function makeScanElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-scan animate-pop-in";
  el.innerHTML = `
    <svg viewBox="0 0 40 40" width="40" height="40" style="display:block">
      <g stroke="${HOOD}" stroke-width="1.8" fill="none" stroke-linecap="round">
        <path d="M5,13 L5,5 L13,5" /><path d="M27,5 L35,5 L35,13" />
        <path d="M35,27 L35,35 L27,35" /><path d="M13,35 L5,35 L5,27" />
      </g>
      <circle cx="20" cy="20" r="3" fill="none" stroke="${HOOD}" stroke-width="1.4" class="radar-reticle-pulse" />
    </svg>`;
  return withRoot(el);
}

function makeRippleElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "click-ripple";
  return withRoot(el);
}

function makeThumbElement(
  l: ListingSummary,
  hot: boolean,
  onClick: () => void,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `thumb-marker${hot ? " thumb-hot" : ""}`;
  const frame = document.createElement("div");
  frame.className = "thumb-frame";
  if (l.primaryPhotoUrl) {
    const img = document.createElement("img");
    img.className = "thumb-img";
    img.src = l.primaryPhotoUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.onerror = () => img.remove();
    frame.appendChild(img);
  }
  const price = document.createElement("span");
  price.className = "thumb-price";
  price.textContent = fmtMoneyShort(l.priceEffectiveMonthly ?? l.priceMonthly) ?? "—";
  frame.appendChild(price);
  el.appendChild(frame);
  const stalk = document.createElement("span");
  stalk.className = "thumb-stalk";
  el.appendChild(stalk);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    el.classList.add("thumb-click");
    window.setTimeout(onClick, 130);
  });
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
  userLocation,
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
  /** id → coords for every active listing (sonar target lookup) */
  radarPoints?: RadarPoint[];
  userLocation?: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const listingsRef = useRef(listings);
  const onSelectRef = useRef(onSelect);
  const onHoodSelectRef = useRef(onHoodSelect);
  const selectedHoodRef = useRef<string | null>(null);
  const hoveredHoodRef = useRef<string | null>(null);
  const lockMarkerRef = useRef<maplibregl.Marker | null>(null);
  const scanMarkerRef = useRef<maplibregl.Marker | null>(null);
  const scanHopTimerRef = useRef<number | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const sonarRafRef = useRef<number | null>(null);
  const thumbsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const searchActiveRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const refreshThumbsRef = useRef<() => void>(() => {});

  /* ---------- Thumbnail markers (imperative, viewport-managed) ---------- */
  const refreshThumbs = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const zoom = map.getZoom();
    const hoodMode = selectedHoodRef.current != null;
    const show = hoodMode || zoom >= 14.3;
    const thumbs = thumbsRef.current;
    if (!show) {
      for (const m of thumbs.values()) m.remove();
      thumbs.clear();
      return;
    }
    const bounds = map.getBounds();
    const cap = hoodMode ? 60 : 40;
    const wanted: ListingSummary[] = [];
    for (const l of listingsRef.current) {
      if (l.latitude == null || l.longitude == null) continue;
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
    // Markers are terrain-aware, so thumbnails ride the raised plateau on
    // their own; a short stalk keeps the hover-above feel.
    for (const l of wanted) {
      let marker = thumbs.get(l.id);
      if (!marker) {
        const el = makeThumbElement(l, searchActiveRef.current, () => {
          spawnRipple(map, [l.longitude!, l.latitude!]);
          onSelectRef.current(l.id);
        });
        marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([l.longitude!, l.latitude!])
          .addTo(map);
        thumbs.set(l.id, marker);
      }
      marker.setOffset([0, -6]);
      const stalk = marker.getElement().querySelector<HTMLElement>(".thumb-stalk");
      if (stalk) stalk.style.height = hoodMode ? "14px" : "0px";
    }
  };
  useEffect(() => {
    listingsRef.current = listings;
    onSelectRef.current = onSelect;
    onHoodSelectRef.current = onHoodSelect;
    refreshThumbsRef.current = refreshThumbs;
  });

  /* ---------- Map boot ---------- */
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    const reduced = prefersReducedMotion();

    registerDemProtocol();
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
        zoom: reduced ? 12.4 : 11.2,
        pitch: reduced ? 55 : 0,
        bearing: reduced ? -14 : 0,
        minZoom: 10.4,
        maxPitch: 72,
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

        // Satellite crater reveal (hidden until a hood lifts)
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
          paint: { "raster-opacity": 0.92, "raster-saturation": -0.15 },
        });
        map.addSource("hood-reveal", { type: "geojson", data: hoodRevealMask(null) });
        map.addLayer({
          id: "hood-reveal-mask",
          type: "fill",
          source: "hood-reveal",
          layout: { visibility: "none" },
          paint: { "fill-color": PAPER, "fill-opacity": 0.9 },
        });

        // Terrain + hillshade from the boostable DEM (masks exist → anchors valid).
        swapTerrain(map, null);

        // Extruded buildings (they drape onto the boosted terrain automatically)
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
        map.addLayer({
          id: "hood-selected-line",
          type: "line",
          source: "hoods",
          filter: ["==", ["get", "name"], "__none__"],
          paint: { "line-color": HOOD_BRIGHT, "line-width": 2.4, "line-opacity": 0.95 },
        });
        map.addLayer({
          id: "hoods-label",
          type: "symbol",
          source: "hoods",
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

        // Sonar (hidden until a search runs)
        map.addSource("sonar-center", { type: "geojson", data: EMPTY_FC });
        for (let i = 0; i < 3; i++) {
          map.addLayer({
            id: `sonar-ring-${i}`,
            type: "circle",
            source: "sonar-center",
            layout: { visibility: "none" },
            paint: {
              "circle-color": "transparent",
              "circle-radius": 0,
              "circle-stroke-color": HOOD,
              "circle-stroke-width": 1.6,
              "circle-stroke-opacity": 0,
              "circle-pitch-alignment": "map",
            },
          });
        }
        map.addSource("sonar-beam", { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: "sonar-beam",
          type: "line",
          source: "sonar-beam",
          layout: { visibility: "none", "line-cap": "round" },
          paint: {
            "line-color": HOOD,
            "line-width": 2,
            "line-opacity": ["get", "o"] as unknown as maplibregl.ExpressionSpecification,
            "line-blur": 1,
          },
        });
        map.addSource("scan-targets", { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: "scan-target-dots",
          type: "circle",
          source: "scan-targets",
          layout: { visibility: "none" },
          paint: {
            "circle-color": HOOD,
            "circle-radius": 3,
            "circle-opacity": 0.9,
            "circle-stroke-color": HALO,
            "circle-stroke-width": 1,
          },
        });
        map.addLayer({
          id: "scan-target-ping",
          type: "circle",
          source: "scan-targets",
          layout: { visibility: "none" },
          paint: {
            "circle-color": "transparent",
            "circle-radius": 6,
            "circle-stroke-color": HOOD,
            "circle-stroke-width": 1.4,
            "circle-stroke-opacity": 0.6,
            "circle-pitch-alignment": "map",
          },
        });

        // Listings
        map.addSource("listings", {
          type: "geojson",
          data: toGeoJson(listingsRef.current),
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 15,
          promoteId: "id",
        });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "listings",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": CLUSTER_COLOR_BROWSE,
            "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 40, 26],
            "circle-stroke-width": 2,
            "circle-stroke-color": HALO,
            "circle-opacity": 0.92,
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
            "text-size": 12,
          },
          paint: { "text-color": "#eaf2ff" },
        });
        map.addLayer({
          id: "match-pulse",
          type: "circle",
          source: "listings",
          filter: ["!", ["has", "point_count"]],
          layout: { visibility: "none" },
          paint: {
            "circle-color": "transparent",
            "circle-radius": 10,
            "circle-stroke-width": 1.6,
            "circle-stroke-color": ACCENT,
            "circle-stroke-opacity": 0.5,
            "circle-pitch-alignment": "map",
          },
        });
        map.addLayer({
          id: "point-selected",
          type: "circle",
          source: "listings",
          filter: ["==", ["get", "id"], "__none__"],
          paint: {
            "circle-color": "transparent",
            "circle-radius": 13,
            "circle-stroke-width": 3,
            "circle-stroke-color": ACCENT,
          },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "listings",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 7,
            "circle-stroke-width": 2,
            "circle-stroke-color": HALO,
            "circle-opacity": ["case", ["get", "approximate"], 0.55, 0.95],
          },
        });
        map.addLayer({
          id: "point-price",
          type: "symbol",
          source: "listings",
          filter: ["!", ["has", "point_count"]],
          minzoom: 13.2,
          layout: {
            "text-field": ["get", "priceShort"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 11,
            "text-offset": [0, -1.45],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": ["get", "color"],
            "text-halo-color": HALO,
            "text-halo-width": 1.6,
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
        map.on("click", "hoods-fill", (e) => {
          const hits = map.queryRenderedFeatures(e.point, {
            layers: ["points", "clusters"],
          });
          if (hits.length > 0) return;
          const name = e.features?.[0]?.properties?.name as string | undefined;
          if (!name) return;
          onHoodSelectRef.current(selectedHoodRef.current === name ? null : name);
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

        const intro = { center: SF_CENTER as [number, number], zoom: 12.5, pitch: 55, bearing: -14 };
        if (reduced || document.visibilityState === "hidden") {
          map.jumpTo(intro);
        } else {
          map.flyTo({ ...intro, duration: 2800, curve: 1.3 });
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
        for (const r of [pulseRafRef, sonarRafRef]) {
          if (r.current != null) cancelAnimationFrame(r.current);
        }
        if (scanHopTimerRef.current != null) clearInterval(scanHopTimerRef.current);
        lockMarkerRef.current?.remove();
        scanMarkerRef.current?.remove();
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

  /* ---------- Sonar ON the map while a search scans ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const reduced = prefersReducedMotion();
    const visible = searching ? "visible" : "none";
    const center: [number, number] =
      userLocation &&
      userLocation.lng > SF_MAX_BOUNDS[0][0] &&
      userLocation.lng < SF_MAX_BOUNDS[1][0] &&
      userLocation.lat > SF_MAX_BOUNDS[0][1] &&
      userLocation.lat < SF_MAX_BOUNDS[1][1]
        ? [userLocation.lng, userLocation.lat]
        : SF_CENTER;

    try {
      for (let i = 0; i < 3; i++) map.setLayoutProperty(`sonar-ring-${i}`, "visibility", visible);
      map.setLayoutProperty("sonar-beam", "visibility", visible);
      map.setLayoutProperty("scan-target-dots", "visibility", visible);
      map.setLayoutProperty("scan-target-ping", "visibility", visible);
      (map.getSource("sonar-center") as GeoJSONSource | undefined)?.setData(
        searching
          ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: center } }
          : EMPTY_FC,
      );
      if (!searching) {
        (map.getSource("sonar-beam") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
        (map.getSource("scan-targets") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      }
    } catch {
      return;
    }

    if (sonarRafRef.current != null) {
      cancelAnimationFrame(sonarRafRef.current);
      sonarRafRef.current = null;
    }
    if (!searching) {
      scanMarkerRef.current?.remove();
      scanMarkerRef.current = null;
      if (scanHopTimerRef.current != null) {
        clearInterval(scanHopTimerRef.current);
        scanHopTimerRef.current = null;
      }
      return;
    }

    // Surveillance pull-up, then the sweep.
    if (!reduced && document.visibilityState !== "hidden") {
      map.flyTo({ center, zoom: 11.7, pitch: 30, bearing: 0, duration: 1500 });
    }
    if (reduced) return;

    const RING_PERIOD = 3000;
    const BEAM_DEG_PER_MS = 0.11;
    const BEAM_LEN = 0.075;
    const cosLat = Math.cos((center[1] * Math.PI) / 180);
    const start = performance.now();
    const tick = (t: number) => {
      const m = mapRef.current;
      if (!m) return;
      const dt = t - start;
      try {
        // Expanding rings, three phases.
        for (let i = 0; i < 3; i++) {
          const k = ((dt + (i * RING_PERIOD) / 3) % RING_PERIOD) / RING_PERIOD;
          m.setPaintProperty(`sonar-ring-${i}`, "circle-radius", k * 480);
          m.setPaintProperty(`sonar-ring-${i}`, "circle-stroke-opacity", 0.42 * (1 - k));
        }
        // Rotating beam with two fading trails.
        const theta = ((dt * BEAM_DEG_PER_MS) % 360) * (Math.PI / 180);
        const beamAt = (angle: number, o: number): GeoJSON.Feature => ({
          type: "Feature",
          properties: { o },
          geometry: {
            type: "LineString",
            coordinates: [
              center,
              [
                center[0] + (BEAM_LEN * Math.sin(angle)) / cosLat,
                center[1] + BEAM_LEN * Math.cos(angle),
              ],
            ],
          },
        });
        (m.getSource("sonar-beam") as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: [
            beamAt(theta, 0.7),
            beamAt(theta - 0.1, 0.32),
            beamAt(theta - 0.2, 0.12),
          ],
        });
        // Target pings once the shortlist is in.
        const k2 = (dt % 1400) / 1400;
        m.setPaintProperty("scan-target-ping", "circle-radius", 5 + k2 * 17);
        m.setPaintProperty("scan-target-ping", "circle-stroke-opacity", 0.6 * (1 - k2));
      } catch {
        return;
      }
      sonarRafRef.current = requestAnimationFrame(tick);
    };
    sonarRafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  // Shortlist arrives: ping the REAL candidates, hop a designator, hone in.
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

    // Hone the camera in on where the candidates concentrate.
    const bounds = new maplibregl.LngLatBounds();
    for (const c of coords) bounds.extend(c);
    if (!bounds.isEmpty() && !prefersReducedMotion() && document.visibilityState !== "hidden") {
      const cam = map.cameraForBounds(bounds, {
        padding: { top: 170, left: 100, right: 100, bottom: 100 },
        maxZoom: 13.8,
        bearing: -10,
      });
      if (cam) map.flyTo({ ...cam, pitch: 38, duration: 2600, curve: 1.2 });
    }

    // Designator hops between the actual shortlisted listings.
    if (scanHopTimerRef.current != null) clearInterval(scanHopTimerRef.current);
    let idx = 0;
    const hop = () => {
      const m = mapRef.current;
      if (!m) return;
      scanMarkerRef.current?.remove();
      scanMarkerRef.current = new maplibregl.Marker({ element: makeScanElement() })
        .setLngLat(coords[idx % coords.length])
        .addTo(m);
      idx++;
    };
    hop();
    scanHopTimerRef.current = window.setInterval(hop, 700);
    return () => {
      if (scanHopTimerRef.current != null) {
        clearInterval(scanHopTimerRef.current);
        scanHopTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanIds, searching]);

  /* ---------- Neighborhood isolate: lift the hood out of the map ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    selectedHoodRef.current = selectedHood;
    const reduced = prefersReducedMotion();
    const hood = hoodByName(selectedHood);

    try {
      map.setFilter("hood-selected-line", [
        "==", ["get", "name"], selectedHood ?? "__none__",
      ]);
      (map.getSource("hood-reveal") as GeoJSONSource | undefined)?.setData(
        hoodRevealMask(selectedHood),
      );
      map.setLayoutProperty("hood-satellite", "visibility", selectedHood ? "visible" : "none");
      map.setLayoutProperty("hood-reveal-mask", "visibility", selectedHood ? "visible" : "none");
      map.setPaintProperty("hoods-line", "line-opacity", selectedHood ? 0.22 : 0.45);
      map.setPaintProperty("hoods-label", "text-opacity", selectedHood ? 0.4 : 0.8);
      // Thumbnails replace dots inside a lifted hood.
      const dotVis = selectedHood ? "none" : "visible";
      for (const id of ["points", "clusters", "cluster-count", "point-price"]) {
        map.setLayoutProperty(id, "visibility", dotVis);
      }
      if (!selectedHood) {
        map.setLayoutProperty(
          "match-pulse",
          "visibility",
          searchActiveRef.current && !reduced ? "visible" : "none",
        );
      } else {
        map.setLayoutProperty("match-pulse", "visibility", "none");
      }
    } catch {
      return;
    }

    // THE LIFT: rebuild terrain from the boosted DEM so the whole neighborhood
    // — imagery, streets, buildings, markers — rises out of the map as a
    // plateau with sheer texture-stretched sides. The camera swoop covers the
    // terrain-tile swap.
    swapTerrain(map, selectedHood);
    refreshThumbsRef.current();

    // Camera: swoop into the hood, or back out to the city frame.
    if (selectedHood && hood) {
      const [[w, s], [e, n]] = multiPolygonBounds(hood.geometry.coordinates);
      const cam = map.cameraForBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: { top: 190, left: 90, right: 90, bottom: 80 }, bearing: -20, maxZoom: 14.6 },
      );
      if (cam) {
        if (reduced || document.visibilityState === "hidden") {
          map.jumpTo({ ...cam, pitch: 58 });
        } else {
          map.flyTo({ ...cam, pitch: 58, duration: 1700, curve: 1.35 });
        }
      }
    } else if (!selectedHood && !searchActiveRef.current) {
      const home = { center: SF_CENTER as [number, number], zoom: 12.5, pitch: 55, bearing: -14 };
      if (reduced || document.visibilityState === "hidden") map.jumpTo(home);
      else map.flyTo({ ...home, duration: 1400, curve: 1.3 });
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
      map.setPaintProperty("points", "circle-radius", searchActive ? 8.5 : 7);
      map.setPaintProperty(
        "point-price",
        "text-color",
        searchActive ? ACCENT : (["get", "color"] as unknown as maplibregl.ExpressionSpecification),
      );
      map.setPaintProperty(
        "clusters",
        "circle-color",
        searchActive ? ACCENT : CLUSTER_COLOR_BROWSE,
      );
      map.setLayerZoomRange("point-price", searchActive ? 12.1 : 13.2, 24);
      if (!selectedHoodRef.current) {
        map.setLayoutProperty(
          "match-pulse",
          "visibility",
          searchActive && !prefersReducedMotion() ? "visible" : "none",
        );
      }
    } catch {
      return;
    }

    if (pulseRafRef.current != null) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    if (searchActive && !prefersReducedMotion()) {
      const tick = (t: number) => {
        if (!mapRef.current || !searchActiveRef.current) return;
        const k = (t % 1700) / 1700;
        try {
          mapRef.current.setPaintProperty("match-pulse", "circle-radius", 9 + k * 24);
          mapRef.current.setPaintProperty("match-pulse", "circle-stroke-opacity", 0.55 * (1 - k));
        } catch {
          return;
        }
        pulseRafRef.current = requestAnimationFrame(tick);
      };
      pulseRafRef.current = requestAnimationFrame(tick);
    }

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
            bearing: -14,
          });
          if (cam) {
            if (prefersReducedMotion() || document.visibilityState === "hidden") {
              map.jumpTo({ ...cam, pitch: 55 });
            } else {
              map.flyTo({ ...cam, pitch: 55, duration: 2000, curve: 1.35 });
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, searchActive ? listings : null]);

  /* ---------- Selection: bracket lock + rooftop dive ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    try {
      map.setFilter("point-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    } catch {
      return;
    }

    lockMarkerRef.current?.remove();
    lockMarkerRef.current = null;

    if (selectedId) {
      const listing = listings.find((l) => l.id === selectedId);
      if (listing?.latitude != null && listing.longitude != null) {
        lockMarkerRef.current = new maplibregl.Marker({
          element: makeBracketElement(),
          pitchAlignment: "map",
          rotationAlignment: "map",
        })
          .setLngLat([listing.longitude, listing.latitude])
          .addTo(map);
        if (prefersReducedMotion() || document.visibilityState === "hidden") {
          map.jumpTo({
            center: [listing.longitude, listing.latitude],
            zoom: Math.max(map.getZoom(), 15.4),
          });
        } else {
          map.flyTo({
            center: [listing.longitude, listing.latitude],
            zoom: Math.max(map.getZoom(), 15.6),
            pitch: 60,
            bearing: -18,
            duration: 1200,
            curve: 1.3,
          });
        }
      }
    }
  }, [selectedId, listings]);

  return (
    <div className="relative h-full w-full bg-paper">
      <div ref={containerRef} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(7,13,24,0.55), rgba(7,13,24,0) 130px), radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.32) 100%)",
        }}
      />
      <div className="pointer-events-none absolute bottom-6 left-3 z-10 flex items-center gap-3 rounded-full border border-white/10 bg-surface/80 px-3.5 py-2 shadow-md backdrop-blur-md">
        {LEGEND.map(([color, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}66` }}
            />
            <span className="text-[10.5px] font-medium text-muted">{label}</span>
          </span>
        ))}
        <span
          className="text-[10.5px] text-faint"
          title="Faded markers are approximate (neighborhood-level) locations. During a search all markers become lock-on targets. Click a neighborhood to lift it out of the map."
        >
          ⓘ
        </span>
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
