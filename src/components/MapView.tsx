"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import type { ListingSummary } from "@/lib/api-types";
import { markerColor } from "@/lib/badges";
import { fmtMoneyShort } from "@/lib/format";

/**
 * The 3D stage. MapLibre renders SF with extruded buildings, a hazy sky, and
 * a choreographed camera: a cinematic descent on load, a pull-up to
 * surveillance altitude while a search scans, then a swoop onto the ranked
 * targets — which pulse like a lock-on, with bracket reticles on selection.
 * All motion collapses to jump-cuts under prefers-reduced-motion.
 */

const SF_CENTER: [number, number] = [-122.4384, 37.7639];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const ACCENT = "#bf4e2c";

const LEGEND: Array<[string, string]> = [
  ["#1E7F4F", "New"],
  ["#1D63DC", "Drop"],
  ["#C2410C", "Verify"],
  ["#C43D7E", "Saved"],
  ["#33302A", "Listing"],
];

const CLUSTER_COLOR_BROWSE = [
  "step", ["get", "point_count"],
  "#4A463E", 10, "#8A6B4F", 40, "#BF4E2C",
] as unknown as maplibregl.ExpressionSpecification;

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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Corner-bracket lock reticle rendered as an HTML marker on the selection. */
function makeBracketElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-lock";
  el.innerHTML = `
    <svg viewBox="0 0 48 48" width="48" height="48" style="display:block">
      <g stroke="${ACCENT}" stroke-width="2.4" fill="none" stroke-linecap="round">
        <path d="M6,16 L6,6 L16,6" />
        <path d="M32,6 L42,6 L42,16" />
        <path d="M42,32 L42,42 L32,42" />
        <path d="M16,42 L6,42 L6,32" />
      </g>
      <circle cx="24" cy="24" r="7.5" fill="none" stroke="${ACCENT}" stroke-width="1.6" class="radar-reticle-pulse" />
    </svg>`;
  return el;
}

export function MapView({
  listings,
  selectedId,
  onSelect,
  searching,
  searchActive,
}: {
  listings: ListingSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searching?: boolean;
  searchActive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const listingsRef = useRef(listings);
  const onSelectRef = useRef(onSelect);
  const lockMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const searchActiveRef = useRef(false);
  useEffect(() => {
    listingsRef.current = listings;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const reduced = prefersReducedMotion();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: SF_CENTER,
      zoom: reduced ? 12.4 : 11.1,
      pitch: reduced ? 55 : 0,
      bearing: reduced ? -14 : 0,
      minZoom: 10,
      maxPitch: 72,
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
      // Hazy horizon so the tilted city reads with depth.
      try {
        map.setSky({
          "sky-color": "#cfe3ee",
          "horizon-color": "#f3ead9",
          "fog-color": "#efe9dc",
          "sky-horizon-blend": 0.55,
          "horizon-fog-blend": 0.5,
          "fog-ground-blend": 0.9,
          "atmosphere-blend": [
            "interpolate", ["linear"], ["zoom"],
            10, 0.28, 13, 0.42, 16, 0.15,
          ] as never,
        });
      } catch (err) {
        console.warn("[apt map] sky unavailable", err);
      }

      // Extruded buildings from the style's own vector source.
      try {
        const layers = map.getStyle().layers ?? [];
        const buildingLayer = layers.find(
          (l) => "source-layer" in l && l["source-layer"] === "building",
        );
        const labelLayer = layers.find(
          (l) => l.type === "symbol" && "layout" in l && (l.layout as Record<string, unknown>)?.["text-field"],
        );
        if (buildingLayer && "source" in buildingLayer) {
          map.addLayer(
            {
              id: "apt-3d-buildings",
              type: "fill-extrusion",
              source: buildingLayer.source as string,
              "source-layer": "building",
              minzoom: 13,
              paint: {
                "fill-extrusion-color": "#e7e1d3",
                "fill-extrusion-height": [
                  "interpolate", ["linear"], ["zoom"],
                  13, 0,
                  13.8, ["coalesce", ["get", "render_height"], 10],
                ],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.72,
              },
            },
            labelLayer?.id,
          );
        }
      } catch (err) {
        console.warn("[apt map] 3d buildings unavailable", err);
      }

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
          "circle-stroke-color": "#ffffff",
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
        paint: { "text-color": "#ffffff" },
      });

      // Lock-on pulse for search targets (driven by rAF while a search is live).
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
          "circle-stroke-color": "#ffffff",
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
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.8,
        },
      });

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
        const feature = e.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      for (const layer of ["clusters", "points"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      loadedRef.current = true;
      map.resize();
      syncData(map, listingsRef.current);

      // Cinematic descent into the city. Hidden/throttled tabs starve rAF and
      // would freeze mid-flight, so jump-cut there and add a stall fallback.
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
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
      lockMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Push listing changes into the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    syncData(map, listings);
  }, [listings]);

  // Surveillance pull-up while a search scans.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !searching) return;
    if (prefersReducedMotion()) return;
    map.flyTo({ center: SF_CENTER, zoom: 11.55, pitch: 26, bearing: 0, duration: 1500 });
  }, [searching]);

  // Target mode: recolor to lock-on accent, start the pulse, swoop onto results.
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
      map.setLayoutProperty(
        "match-pulse",
        "visibility",
        searchActive && !prefersReducedMotion() ? "visible" : "none",
      );
    } catch {
      /* layers not ready yet */
    }

    // Uniform lock-on ping across all targets.
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

    // Swoop the camera onto the result set.
    if (searchActive) {
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
            if (prefersReducedMotion()) {
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

  // Selection: bracket lock marker + dive to the rooftop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("point-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);

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
        if (prefersReducedMotion()) {
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
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* Cinematic vignette + top wash for HUD readability */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(246,244,239,0.5), rgba(246,244,239,0) 130px), radial-gradient(120% 90% at 50% 45%, rgba(35,33,28,0) 62%, rgba(35,33,28,0.16) 100%)",
        }}
      />
      {/* Compact legend chip */}
      <div className="pointer-events-none absolute bottom-6 left-3 z-10 flex items-center gap-3 rounded-full border border-white/60 bg-surface/80 px-3.5 py-2 shadow-md backdrop-blur-md">
        {LEGEND.map(([color, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10.5px] font-medium text-muted">{label}</span>
          </span>
        ))}
        <span
          className="text-[10.5px] text-faint"
          title="Faded markers are approximate (neighborhood-level) locations. During a search, all markers turn terracotta targets."
        >
          ⓘ
        </span>
      </div>
    </div>
  );
}

function syncData(map: maplibregl.Map, listings: ListingSummary[]) {
  const source = map.getSource("listings") as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(toGeoJson(listings));
}
