"""CLI: search one (logo, area) combination and save the ranked results."""
import argparse, pickle, sys, time
import numpy as np
sys.path.insert(0, "src")
from design import design
from logo_strokes import (anthropic_strokes, anthropic_centerline,
                          claude_star, claude_rays, pick_rays)
from nbhd import AREAS

def get_strokes(logo, k, hub=0.145):
    if logo == "anthropic":  return anthropic_strokes()
    if logo == "anthropic-c": return anthropic_centerline()
    if logo == "claude":
        P, v, rays = claude_rays()
        return claude_star(keep_rays=pick_rays(rays, k), hub_r=hub)
    raise SystemExit("unknown logo")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", required=True)
    ap.add_argument("--area", required=True)
    ap.add_argument("--rays", type=int, default=10)
    ap.add_argument("--hub", type=float, default=0.145)
    ap.add_argument("--corridor", type=float, default=760.0)
    ap.add_argument("--wdev", type=float, default=11.0)
    ap.add_argument("--widths", default="0.62,0.70,0.78")
    ap.add_argument("--rots", default="")
    ap.add_argument("--grid", type=float, default=430)
    ap.add_argument("--topn", type=int, default=6)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--lo", type=float, default=3.0)
    ap.add_argument("--hi", type=float, default=5.0)
    ap.add_argument("--box", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    widths = [float(x) for x in a.widths.split(",")]
    if a.rots:
        rots = [float(x) for x in a.rots.split(",")]
    elif a.logo.startswith("anthropic"):
        rots = [-10, -5, 0, 5, 10]
    else:
        rots = list(np.arange(0, 360, 15))
    box = tuple(float(x) for x in a.box.split(",")) if a.box else AREAS[a.area]
    S = get_strokes(a.logo, a.rays, a.hub)
    kw = (dict(corridor=a.corridor, w_dev=a.wdev, dev_ref=230.0)
          if a.logo == "claude" else {})
    t = time.time()
    wb = (min(widths) * 0.97, max(widths) * 1.05)
    rb = ((min(rots) - 4.0, max(rots) + 4.0) if a.logo.startswith("anthropic") else None)
    res = design(S, box, widths, rots, grid_ft=a.grid, topn=a.topn, k=a.k,
                 label=f"{a.logo}/{a.area}", snap_kw=kw, lo=a.lo, hi=a.hi,
                 width_bounds=wb, rot_bounds=rb)
    for r in res: r["area"] = a.area; r["logo"] = a.logo; r["rays"] = a.rays
    pickle.dump(res, open(a.out, "wb"))
    print(f"[{a.logo}/{a.area}] {len(res)} results in {time.time()-t:.0f}s -> {a.out}")
    if res:
        b = res[0]
        print(f"  best: {b['dist']:.2f}mi gain={b['gain']:.0f}ft match={b['match']['match']*100:.2f}%")
