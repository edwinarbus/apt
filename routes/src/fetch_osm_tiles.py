"""Fallback: fetch SF's runnable ways in tiles (each query is small enough to
finish fast) and merge into one Overpass-shaped JSON."""
import json, sys, time, urllib.parse, urllib.request, os

MIRRORS = ["https://overpass.kumi.systems/api/interpreter",
           "https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter",
           "https://overpass.osm.ch/api/interpreter"]
HW = ("primary|secondary|tertiary|unclassified|residential|living_street|service|"
      "pedestrian|footway|path|track|cycleway|steps|primary_link|secondary_link|tertiary_link")
S, W, N, E = 37.7020, -122.5180, 37.8150, -122.3500
NY, NX = 4, 4

def q(s, w, n, e):
    return f'[out:json][timeout:180];(way["highway"~"^({HW})$"]({s},{w},{n},{e}););out body;>;out skel qt;'

def get(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(4):
        for m in MIRRORS:
            try:
                req = urllib.request.Request(m, data=data,
                        headers={"User-Agent": "sf-gpsart/1.0 (personal route planning)"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.loads(r.read())
            except Exception as ex:
                sys.stderr.write(f"   {m.split('/')[2]}: {type(ex).__name__}\n"); sys.stderr.flush()
                time.sleep(3 + 3 * attempt)
    raise RuntimeError("tile failed")

if __name__ == "__main__":
    out = sys.argv[1]
    elems, seen = [], set()
    for iy in range(NY):
        for ix in range(NX):
            s = S + (N - S) * iy / NY; n = S + (N - S) * (iy + 1) / NY
            w = W + (E - W) * ix / NX; e = W + (E - W) * (ix + 1) / NX
            # small overlap so ways spanning a tile edge stay connected
            r = get(q(s - 0.002, w - 0.002, n + 0.002, e + 0.002))
            new = 0
            for el in r["elements"]:
                key = (el["type"], el["id"])
                if key in seen: continue
                seen.add(key); elems.append(el); new += 1
            sys.stderr.write(f"tile {iy},{ix}: +{new} (total {len(elems)})\n"); sys.stderr.flush()
            time.sleep(1.5)
    json.dump({"elements": elems}, open(out, "w"))
    sys.stderr.write(f"wrote {out}: {len(elems)} elements\n")
