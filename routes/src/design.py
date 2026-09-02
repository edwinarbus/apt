"""Search for the best runnable placement of a logo in a given part of the city."""
import time
import numpy as np
from ctx import load, elev_ft
from graph import xy_to_ll
from place import search, fit_score, FT_PER_MI
from build import snap_logo, assemble, shape_match, route_points, path_len_ft

MAX_MI = 6.2


def elev_gain_ft(latlon, smooth=9, thresh=2.0):
    """Positive elevation gain, smoothed so DEM noise doesn't inflate it."""
    e = elev_ft(latlon[:, 0], latlon[:, 1])
    if len(e) >= smooth:
        k = np.ones(smooth) / smooth
        e = np.convolve(e, k, mode="same")
        e[:smooth] = e[smooth]; e[-smooth:] = e[-smooth-1]
    d = np.diff(e)
    d = d[np.abs(d) > thresh / 10.0]
    return float(np.sum(np.clip(d, 0, None))), float(e.min()), float(e.max())


def score_route(dist_mi, gain_ft, m, lo=3.0, hi=5.0):
    s = 1000.0 * m["match"] + 700.0 * m["stray"]
    if dist_mi > MAX_MI: s += 8000.0 * (dist_mi - MAX_MI) + 3000.0
    if dist_mi > hi:     s += 260.0 * (dist_mi - hi)
    if dist_mi < lo:     s += 200.0 * (lo - dist_mi)
    s += gain_ft / 3.0
    return s


def design(strokes, area_box, widths_mi, rots, grid_ft=420, topn=8, k=3,
           label="", verbose=True, snap_kw=None, lo=3.0, hi=5.0,
           width_bounds=None, rot_bounds=None):
    c = load(); g, keep, tree, sn = c['g'], c['keep'], c['tree'], c['sn']
    snap_kw = snap_kw or {}
    cands = search(strokes, tree, area_box, widths_mi, rots, grid_ft=grid_ft, topn=topn,
                   width_bounds=width_bounds, rot_bounds=rot_bounds)
    out = []
    for (sc, cx, cy, wft, r, f) in cands:
        t = time.time()
        snapped = snap_logo(sn, strokes, np.array([cx, cy]), wft, r, k=k, **snap_kw)
        if snapped is None: continue
        a = assemble(sn, snapped)
        if a is None: continue
        full, connlen = a
        dist = path_len_ft(g, full) / 5280.0
        ll = route_points(g, full)
        gain, emin, emax = elev_gain_ft(ll)
        m = shape_match(g, full, [s["ideal"] for s in snapped], wft)
        S = score_route(dist, gain, m, lo, hi)
        la, lo_ = xy_to_ll(cx, cy)
        rec = dict(score=S, dist=dist, gain=gain, emin=emin, emax=emax, match=m,
                   center=(float(la), float(lo_)), cx=cx, cy=cy, width_ft=wft,
                   rot=r, fit=f, nodes=full, snapped=snapped, connlen=connlen,
                   latlon=ll, label=label)
        out.append(rec)
        if verbose:
            print(f"   [{label}] w={wft/FT_PER_MI:.2f}mi rot={r:+5.1f} @{la:.5f},{lo_:.5f} "
                  f"dist={dist:5.2f}mi gain={gain:4.0f}ft match={m['match']*100:5.2f}% "
                  f"stray={m['stray']*100:4.2f}% score={S:7.1f} ({time.time()-t:.0f}s)")
    out.sort(key=lambda d: d["score"])
    return out
