"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import type { ListingSummary } from "@/lib/api-types";
import { markerColor } from "@/lib/badges";
import { fmtMoneyShort } from "@/lib/format";

const SF_CENTER: [number, number] = [-122.4384, 37.7639];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const LEGEND: Array<[string, string]> = [
  ["#1E7F4F", "New today"],
  ["#1D63DC", "Price drop"],
  ["#C2410C", "Verify carefully"],
  ["#C43D7E", "Saved"],
  ["#6D28D9", "Contacted"],
  ["#8A857B", "Missing/stale"],
  ["#33302A", "Listing"],
];

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

export function MapView({
  listings,
  selectedId,
  onSelect,
}: {
  listings: ListingSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  const listingsRef = useRef(listings);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    listingsRef.current = listings;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: SF_CENTER,
      zoom: 12.05,
      minZoom: 10,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("error", (e) => console.error("[apt map]", e.error?.message ?? e));
    // Debug handle for poking at layers/sources from the console.
    (window as unknown as { __aptMap?: maplibregl.Map }).__aptMap = map;

    map.on("load", () => {
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
          "circle-color": [
            "step", ["get", "point_count"],
            "#4A463E", 10, "#8A6B4F", 40, "#BF4E2C",
          ],
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
      map.addLayer({
        id: "point-selected",
        type: "circle",
        source: "listings",
        filter: ["==", ["get", "id"], "__none__"],
        paint: {
          "circle-color": "transparent",
          "circle-radius": 13,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#BF4E2C",
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
          // Neighborhood-level (approximate) locations render slightly ghosted.
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
      syncData(map, listingsRef.current, fittedRef);
    });

    // MapLibre's built-in resize tracking can miss the container's first
    // layout (it may measure 0x0 during mount); observe it ourselves.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Push listing changes into the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    syncData(map, listings, fittedRef);
  }, [listings]);

  // Selection ring + fly to the selected listing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("point-selected", [
      "==", ["get", "id"], selectedId ?? "__none__",
    ]);
    if (selectedId) {
      const listing = listings.find((l) => l.id === selectedId);
      if (listing?.latitude != null && listing.longitude != null) {
        map.easeTo({
          center: [listing.longitude, listing.latitude],
          zoom: Math.max(map.getZoom(), 13.8),
          duration: 650,
        });
      }
    }
  }, [selectedId, listings]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-6 left-3 z-10 rounded-xl border border-line bg-surface/92 px-3 py-2.5 shadow-sm backdrop-blur-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {LEGEND.map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-muted">{label}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 max-w-[190px] text-[10px] leading-tight text-faint">
          Faded markers are approximate (neighborhood-level) locations.
        </p>
      </div>
    </div>
  );
}

function syncData(
  map: maplibregl.Map,
  listings: ListingSummary[],
  fittedRef: React.RefObject<boolean>,
) {
  const source = map.getSource("listings") as GeoJSONSource | undefined;
  if (!source) return;
  const data = toGeoJson(listings);
  source.setData(data);
  if (!fittedRef.current && data.features.length > 0) {
    fittedRef.current = true;
    // Fit to SF-proper coordinates so a stray out-of-town pin can't drag the
    // initial view out to the whole Bay Area.
    const bounds = new maplibregl.LngLatBounds();
    let extended = 0;
    for (const f of data.features) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (lat > 37.6 && lat < 37.85 && lng > -122.56 && lng < -122.3) {
        bounds.extend([lng, lat]);
        extended++;
      }
    }
    if (extended > 0) {
      map.fitBounds(bounds, { padding: 70, maxZoom: 13.5, duration: 900 });
    }
  }
}
