"use client";

import ReactDOM from "react-dom";

/**
 * Warm the map's network path before MapLibre even boots. The basemap style,
 * glyphs, sprites, and vector tiles ALL come from tiles.openfreemap.org, so a
 * single preconnect (DNS + TLS) means the map's first requests skip the cold
 * handshake, and preloading the style JSON gets the actual tiles requested a
 * round-trip sooner (MapLibre can't ask for a tile until it has the style).
 * The neighborhood reveal pulls Esri satellite imagery — preconnected too, so
 * the first isolate doesn't stall on a fresh connection.
 *
 * Rendered from the root layout: React emits these hints into the initial HTML
 * <head>, so they fire during page parse, before the app's JS runs.
 */
export function PreloadResources() {
  ReactDOM.preconnect("https://tiles.openfreemap.org", { crossOrigin: "anonymous" });
  ReactDOM.preload("https://tiles.openfreemap.org/styles/positron", {
    as: "fetch",
    crossOrigin: "anonymous",
  });
  ReactDOM.preconnect("https://server.arcgisonline.com", { crossOrigin: "anonymous" });
  return null;
}
