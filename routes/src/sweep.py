"""Sweep (ray count, hub, width) configs over one area; keep the best fits."""
import argparse, pickle, sys
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from citysearch import scan, dedupe
from logo_strokes import claude_star, claude_rays, pick_rays
from snap_at import run

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", required=True)
    ap.add_argument("--configs", required=True, help="nray:hub:width,...")
    ap.add_argument("--grid", type=float, default=420)
    ap.add_argument("--nplace", type=int, default=4)
    ap.add_argument("--sep", type=float, default=1300)
    ap.add_argument("--whill", type=float, default=0.9)
    ap.add_argument("--wbakery", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    box = tuple(float(x) for x in a.box.split(","))
    c = load(); P, v, rays = claude_rays()
    allout = []
    for cfg in a.configs.split(","):
        nray, hub, w = cfg.split(":")
        nray = int(nray); hub = float(hub); w = float(w)
        S = claude_star(keep_rays=pick_rays(rays, nray), hub_r=hub)
        cands = dedupe(scan(S, c['tree'], [w], list(np.arange(0, 360, 15)),
                            grid_ft=a.grid, box=box, w_hill=a.whill,
                            w_bakery=a.wbakery, topn=80),
                       min_sep_ft=a.sep)
        pl = [(cx, cy, wft, r) for sc, cx, cy, wft, r, md, dd, rg in cands[:a.nplace]]
        tag = f"r{nray}h{hub:.2f}w{w:.2f}"
        out = run(S, pl, k=4, label=tag,
                  snap_kw=dict(corridor=470, w_dev=26, dev_ref=170))
        for r in out: r["cfg"] = tag; r["rays"] = nray; r["hub"] = hub; r["logo"] = "claude"
        allout += out
    allout.sort(key=lambda r: -r["iou"])
    pickle.dump(allout, open(a.out, "wb"))
    print(f"{len(allout)} results -> {a.out}")
