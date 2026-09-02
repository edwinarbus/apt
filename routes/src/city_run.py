"""Scan a box for good placements, snap the best of them, save ranked results."""
import argparse, pickle, sys, time
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from citysearch import scan, dedupe, SF_BOX
from logo_strokes import (anthropic_strokes, anthropic_centerline, claude_star,
                          claude_rays, pick_rays)
from snap_at import run

def strokes_for(a):
    if a.logo == "anthropic":   return anthropic_strokes()
    if a.logo == "anthropic-c": return anthropic_centerline()
    P, v, rays = claude_rays()
    return claude_star(keep_rays=pick_rays(rays, a.rays), hub_r=a.hub)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", required=True)
    ap.add_argument("--rays", type=int, default=8)
    ap.add_argument("--hub", type=float, default=0.13)
    ap.add_argument("--widths", default="0.72,0.80")
    ap.add_argument("--rots", default="")
    ap.add_argument("--grid", type=float, default=540)
    ap.add_argument("--box", default="")
    ap.add_argument("--nplace", type=int, default=10)
    ap.add_argument("--sep", type=float, default=1400)
    ap.add_argument("--corridor", type=float, default=560)
    ap.add_argument("--wdev", type=float, default=18)
    ap.add_argument("--devref", type=float, default=200)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--whill", type=float, default=0.9)
    ap.add_argument("--wbakery", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    widths = [float(x) for x in a.widths.split(",")]
    if a.rots: rots = [float(x) for x in a.rots.split(",")]
    elif a.logo.startswith("anthropic"): rots = [-10, -5, 0, 5, 10]
    else: rots = list(np.arange(0, 360, 20))
    box = tuple(float(x) for x in a.box.split(",")) if a.box else SF_BOX
    c = load(); S = strokes_for(a)
    t = time.time()
    cands = dedupe(scan(S, c['tree'], widths, rots, grid_ft=a.grid, box=box,
                        w_hill=a.whill, w_bakery=a.wbakery, topn=90), min_sep_ft=a.sep)
    pl = [(cx, cy, wft, r) for sc, cx, cy, wft, r, md, dd, rg in cands[:a.nplace]]
    lab = f"{a.logo}{a.rays if a.logo=='claude' else ''}"
    out = run(S, pl, k=a.k, label=lab,
              snap_kw=dict(corridor=a.corridor, w_dev=a.wdev, dev_ref=a.devref))
    for r in out: r['rays'] = a.rays; r['hub'] = a.hub; r['logo'] = a.logo
    pickle.dump(out, open(a.out, "wb"))
    print(f"[{lab}] {len(out)} results in {time.time()-t:.0f}s -> {a.out}")
