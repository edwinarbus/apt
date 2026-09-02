"""Snap and assemble a logo at explicit placements, then score them."""
import sys, pickle
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from graph import xy_to_ll
from build import snap_logo, assemble, shape_match, route_points, path_len_ft
from design import elev_gain_ft
from vismatch import vis_match
from graph import ll_to_xy

ANCHOR = (37.7712, -122.4335)   # Duboce Triangle, a neighbourhood-level anchor for 'start nearby'
HX, HY = ll_to_xy(*ANCHOR)


def run(strokes, placements, k=3, snap_kw=None, label="", verbose=True, max_mi=6.2):
    c = load(); g, sn = c['g'], c['sn']
    snap_kw = snap_kw or {}
    out = []
    for (cx, cy, wft, r) in placements:
        snapped = snap_logo(sn, strokes, np.array([cx, cy]), wft, r, k=k, **snap_kw)
        if snapped is None: continue
        a = assemble(sn, snapped)
        if a is None: continue
        full, connlen = a
        dist = path_len_ft(g, full) / 5280.0
        ll = route_points(g, full)
        gain, emin, emax = elev_gain_ft(ll)
        p = np.asarray(full)
        v = vis_match(np.c_[g.X[p], g.Y[p]], [s['ideal'] for s in snapped], wft, tol_ft=95)
        m = shape_match(g, full, [s['ideal'] for s in snapped], wft)
        la, lo = xy_to_ll(cx, cy)
        pp = np.asarray(full)
        d_anchor = float(np.min(np.hypot(g.X[pp] - HX, g.Y[pp] - HY)) / 5280.0)
        rec = dict(d_anchor=d_anchor, dist=dist, gain=gain, emin=emin, emax=emax, iou=v['iou'],
                   cover=v['cover'], prec=v['prec'], match=m, nodes=full,
                   snapped=snapped, latlon=ll, width_ft=wft, rot=r,
                   center=(float(la), float(lo)), cx=cx, cy=cy, connlen=connlen,
                   label=label)
        out.append(rec)
        if verbose:
            flag = "" if dist <= max_mi else "  OVER-CAP"
            print(f"   [{label}] w={wft/5280:.2f} rot={r:5.1f} @{la:.5f},{lo:.5f} "
                  f"dist={dist:5.2f}mi gain={gain:4.0f}ft IoU={v['iou']*100:5.1f}% "
                  f"cov={v['cover']*100:4.0f}% prec={v['prec']*100:4.0f}% "
                  f"near={d_anchor:.2f}mi{flag}")
    out.sort(key=lambda d: -d['iou'])
    return out
