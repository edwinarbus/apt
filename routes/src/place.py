"""Search over logo placements (centre, size, rotation) for the best street fit."""
import numpy as np
from scipy.spatial import cKDTree
from graph import ll_to_xy, xy_to_ll

FT_PER_MI = 5280.0


def densify_graph(g, ok=None, step=45.0):
    """Point cloud along every runnable edge, for fast 'how far is the nearest
    street' queries."""
    X, Y = g.X, g.Y
    ok = np.ones(len(X), bool) if ok is None else ok
    pts, seen = [], set()
    for i, lst in enumerate(g.nbrs):
        if not ok[i]: continue
        for (j, ln, mult, wid) in lst:
            if not ok[j] or (min(i, j), max(i, j)) in seen: continue
            seen.add((min(i, j), max(i, j)))
            n = max(2, int(ln / step) + 1)
            t = np.linspace(0, 1, n)
            pts.append(np.c_[X[i] + t * (X[j] - X[i]), Y[i] + t * (Y[j] - Y[i])])
    P = np.vstack(pts)
    return P, cKDTree(P)


def transform(strokes, center_xy, width_ft, rot_deg):
    """Normalized logo space -> local XY feet."""
    th = np.radians(rot_deg)
    R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    return [ (s.pts @ R.T) * width_ft + center_xy for s in strokes ]


def sample_strokes(polys, step=40.0):
    out = []
    for p in polys:
        for a, b in zip(p[:-1], p[1:]):
            L = float(np.hypot(*(b - a)))
            n = max(2, int(L / step) + 1)
            t = np.linspace(0, 1, n)[:, None]
            out.append(a + t * (b - a))
    return np.vstack(out)


def fit_score(strokes, tree, center_xy, width_ft, rot_deg, step=40.0, dead=520.0):
    polys = transform(strokes, center_xy, width_ft, rot_deg)
    S = sample_strokes(polys, step)
    d, _ = tree.query(S)
    dead_frac = float((d > dead).mean())
    return dict(mean=float(d.mean()), p50=float(np.percentile(d, 50)),
                p90=float(np.percentile(d, 90)), mx=float(d.max()),
                dead=dead_frac, n=len(S),
                score=float(d.mean() + 0.6 * np.percentile(d, 90) + 900.0 * dead_frac))


def search(strokes, tree, bbox_ll, widths_mi, rots, grid_ft=340.0, topn=12,
           refine=True, dead=520.0, width_bounds=None, rot_bounds=None):
    """Coarse grid over centres x sizes x rotations, then local refinement."""
    (s, w, n, e) = bbox_ll
    x0, y0 = ll_to_xy(s, w); x1, y1 = ll_to_xy(n, e)
    xs = np.arange(min(x0, x1), max(x0, x1), grid_ft)
    ys = np.arange(min(y0, y1), max(y0, y1), grid_ft)
    res = []
    for wm in widths_mi:
        wft = wm * FT_PER_MI
        for r in rots:
            for cx in xs:
                for cy in ys:
                    f = fit_score(strokes, tree, np.array([cx, cy]), wft, r,
                                  step=70.0, dead=dead)
                    res.append((f["score"], cx, cy, wft, r, f))
    res.sort(key=lambda t: t[0])
    res = res[:topn * 4]
    if refine:
        # Street fit always improves as the drawing shrinks, so size and rotation
        # stay inside the bounds the caller asked for; only position is free.
        wlo = (min(widths_mi) * 0.97 if width_bounds is None else width_bounds[0]) * FT_PER_MI
        whi = (max(widths_mi) * 1.03 if width_bounds is None else width_bounds[1]) * FT_PER_MI
        rlo = min(rots) - 3.0 if rot_bounds is None else rot_bounds[0]
        rhi = max(rots) + 3.0 if rot_bounds is None else rot_bounds[1]
        out = []
        for (sc, cx, cy, wft, r, f) in res[:topn * 2]:
            best = (sc, cx, cy, wft, r, f)
            for _ in range(4):
                improved = False
                for dx in (-150, -70, 0, 70, 150):
                    for dy in (-150, -70, 0, 70, 150):
                        for dr in (-3, -1, 0, 1, 3):
                            for dw in (0.97, 0.99, 1.0, 1.01, 1.03):
                                c = np.array([best[1] + dx, best[2] + dy])
                                ww = float(np.clip(best[3] * dw, wlo, whi))
                                rr = float(np.clip(best[4] + dr, rlo, rhi))
                                f2 = fit_score(strokes, tree, c, ww, rr, step=45.0, dead=dead)
                                if f2["score"] < best[0] - 1e-6:
                                    best = (f2["score"], c[0], c[1], ww, rr, f2); improved = True
                if not improved: break
            out.append(best)
        out.sort(key=lambda t: t[0])
        res = out
    return res[:topn]
