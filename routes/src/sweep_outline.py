"""Sweep the Claude mark's true outline (not the star approximation) over an area."""
import argparse, pickle, sys, time
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from citysearch import scan, dedupe
from logo_strokes import claude_outline, claude_rays, pick_rays
from snap_at import run

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", required=True)
    ap.add_argument("--configs", required=True, help="nray:width,...  (nray 12 = all)")
    ap.add_argument("--simplify", type=float, default=0.012)
    ap.add_argument("--grid", type=float, default=420)
    ap.add_argument("--nplace", type=int, default=4)
    ap.add_argument("--sep", type=float, default=1400)
    ap.add_argument("--whill", type=float, default=0.9)
    ap.add_argument("--wbakery", type=float, default=20)
    ap.add_argument("--corridor", type=float, default=300)
    ap.add_argument("--wdev", type=float, default=34)
    ap.add_argument("--devref", type=float, default=110)
    ap.add_argument("--rotstep", type=float, default=15)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    box = tuple(float(x) for x in a.box.split(","))
    c = load()
    P, v, rays = claude_rays()
    allout = []
    for cfg in a.configs.split(","):
        nray, w = cfg.split(":")
        nray = int(nray); w = float(w)
        keep = None if nray >= 12 else pick_rays(rays, nray)
        S = claude_outline(keep_rays=keep, simplify=a.simplify)
        cands = dedupe(scan(S, c['tree'], [w], list(np.arange(0, 360, a.rotstep)),
                            grid_ft=a.grid, box=box, w_hill=a.whill,
                            w_bakery=a.wbakery, topn=90), min_sep_ft=a.sep)
        pl = [(cx, cy, wft, r) for sc, cx, cy, wft, r, md, dd, rg in cands[:a.nplace]]
        tag = f"outline{nray}w{w:.2f}"
        out = run(S, pl, k=3, label=tag,
                  snap_kw=dict(corridor=a.corridor, w_dev=a.wdev, dev_ref=a.devref))
        for r in out:
            r["cfg"] = tag; r["rays"] = nray; r["logo"] = "claude"; r["repr"] = "outline"
        allout += out
    allout.sort(key=lambda r: -r["iou"])
    pickle.dump(allout, open(a.out, "wb"))
    print(f"{len(allout)} results -> {a.out}")
