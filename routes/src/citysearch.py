"""Citywide placement search: sweep every flat, well-gridded spot in SF."""
import sys, time, pickle, argparse
sys.path.insert(0, "src")
import numpy as np
from ctx import load, elev_ft
from graph import ll_to_xy, xy_to_ll
from place import transform, sample_strokes, FT_PER_MI
from bakeries import load as _load_bakeries

_BK = {}

def bakery_tree():
    """KD-tree of bakery POIs in local feet, for the on-route bakery bonus."""
    if not _BK:
        from scipy.spatial import cKDTree
        rows = _load_bakeries()
        xy = np.array([ll_to_xy(r["lat"], r["lon"]) for r in rows]).reshape(len(rows), 2)
        _BK["rows"] = rows; _BK["xy"] = xy; _BK["tree"] = cKDTree(xy)
    return _BK

SF_BOX = (37.7080, -122.5120, 37.8100, -122.3600)


def hill_penalty(latlon_samples):
    e = elev_ft(latlon_samples[:, 0], latlon_samples[:, 1])
    return float(e.max() - e.min()), float(np.std(e))


def scan(strokes, tree, widths_mi, rots, grid_ft=520.0, box=SF_BOX,
         step=75.0, dead=520.0, w_hill=0.9, topn=60, w_bakery=0.0,
         bakery_ft=750.0, bakery_target=3):
    x0, y0 = ll_to_xy(box[0], box[1]); x1, y1 = ll_to_xy(box[2], box[3])
    xs = np.arange(min(x0, x1), max(x0, x1), grid_ft)
    ys = np.arange(min(y0, y1), max(y0, y1), grid_ft)
    out = []
    t0 = time.time()
    n = 0
    for wm in widths_mi:
        wft = wm * FT_PER_MI
        for r in rots:
            polys0 = transform(strokes, np.array([0.0, 0.0]), wft, r)
            S0 = sample_strokes(polys0, step)
            for cx in xs:
                for cy in ys:
                    S = S0 + np.array([cx, cy])
                    d, _ = tree.query(S)
                    md = float(d.mean())
                    if md > 210.0:            # nowhere near enough streets
                        continue
                    deadf = float((d > dead).mean())
                    if deadf > 0.02: continue
                    la, lo = xy_to_ll(S[:, 0], S[:, 1])
                    rng, sd = hill_penalty(np.c_[la, lo])
                    sc = md + 0.6 * float(np.percentile(d, 90)) + 900.0 * deadf + w_hill * rng
                    if w_bakery:
                        B = bakery_tree()
                        near = B["tree"].query_ball_point(S, bakery_ft)
                        nb = len({j for lst in near for j in lst})
                        sc -= w_bakery * min(nb, bakery_target)
                    out.append((sc, cx, cy, wft, r, md, deadf, rng))
                    n += 1
    out.sort(key=lambda t: t[0])
    print(f"   scanned, {n} feasible, {time.time()-t0:.0f}s", file=sys.stderr)
    return out[:topn]


def dedupe(cands, min_sep_ft=1400.0):
    """Keep only spatially distinct placements."""
    keep = []
    for c in cands:
        if all(np.hypot(c[1] - k[1], c[2] - k[2]) > min_sep_ft for k in keep):
            keep.append(c)
    return keep
