"""Download runnable OSM ways for San Francisco via Overpass, with mirror failover."""
import json, sys, time, urllib.parse, urllib.request, os

BBOX = (37.7020, -122.5180, 37.8150, -122.3500)  # S, W, N, E
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
# Runnable: roads a person can run on + dedicated foot/park paths.
QUERY = f"""
[out:json][timeout:600];
(
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|path|track|cycleway|steps|primary_link|secondary_link|tertiary_link)$"]
     ({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body;
>;
out skel qt;
"""

def fetch(out_path):
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for attempt in range(3):
        for m in MIRRORS:
            try:
                sys.stderr.write(f"[try] {m} (attempt {attempt+1})\n"); sys.stderr.flush()
                req = urllib.request.Request(m, data=data,
                        headers={"User-Agent": "sf-gpsart/1.0 (personal route planning)"})
                with urllib.request.urlopen(req, timeout=600) as r:
                    raw = r.read()
                if len(raw) < 100000:
                    sys.stderr.write(f"  too small ({len(raw)}B): {raw[:200]!r}\n"); continue
                open(out_path, "wb").write(raw)
                sys.stderr.write(f"  OK {len(raw)/1e6:.1f} MB -> {out_path}\n")
                return True
            except Exception as e:
                last = e
                sys.stderr.write(f"  fail: {type(e).__name__}: {e}\n")
                time.sleep(4 * (attempt + 1))
    raise SystemExit(f"all mirrors failed: {last}")

if __name__ == "__main__":
    fetch(sys.argv[1] if len(sys.argv) > 1 else "data/sf_osm.json")
