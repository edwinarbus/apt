"""Coarse elevation grid over SF from USGS 10 m NED, via opentopodata."""
import json, sys, time, urllib.request, urllib.parse
import numpy as np

S, W, N, E = 37.700, -122.522, 37.818, -122.348
STEP_M = 140.0
URL = "https://api.opentopodata.org/v1/ned10m"

def main(out):
    dlat = STEP_M / 110574.0
    dlon = STEP_M / (111320.0 * np.cos(np.radians(37.76)))
    lats = np.arange(S, N, dlat); lons = np.arange(W, E, dlon)
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    pts = np.c_[LA.ravel(), LO.ravel()]
    print(f"grid {LA.shape} = {len(pts)} points", file=sys.stderr)
    z = np.full(len(pts), np.nan)
    B = 100
    i = 0
    while i < len(pts):
        chunk = pts[i:i+B]
        loc = "|".join(f"{a:.6f},{b:.6f}" for a, b in chunk)
        body = urllib.parse.urlencode({"locations": loc}).encode()
        ok = False
        for attempt in range(6):
            try:
                req = urllib.request.Request(URL, data=body,
                       headers={"User-Agent": "sf-gpsart/1.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    d = json.loads(r.read())
                if d.get("status") == "OK":
                    for k, res in enumerate(d["results"]):
                        e = res.get("elevation")
                        if e is not None: z[i+k] = e
                    ok = True; break
                time.sleep(3 + 2*attempt)
            except Exception as ex:
                print(f"  retry {attempt}: {type(ex).__name__} {ex}", file=sys.stderr)
                time.sleep(3 + 2*attempt)
        if not ok:
            print(f"  chunk {i} failed", file=sys.stderr)
        i += B
        if (i // B) % 20 == 0:
            print(f"  {i}/{len(pts)}  nan={np.isnan(z).sum()}", file=sys.stderr); sys.stderr.flush()
        time.sleep(1.05)
    np.savez_compressed(out, lats=lats, lons=lons, z=z.reshape(LA.shape))
    print(f"saved {out}; nan={np.isnan(z).sum()}/{len(z)}", file=sys.stderr)

main(sys.argv[1])
