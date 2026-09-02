"""Parse official logo SVGs into polylines usable as GPS-art stroke geometry."""
import re, math
import numpy as np
from svgpathtools import parse_path

def load_svg_paths(fn):
    s = open(fn, encoding='utf-8').read()
    vb = re.search(r'viewBox="([^"]+)"', s)
    vb = [float(x) for x in vb.group(1).split()] if vb else None
    ds = re.findall(r'\sd="([^"]+)"', s)
    return vb, ds

def path_to_polys(d, samples_per_unit=6.0, min_pts=8):
    """Each subpath -> closed polyline (Nx2), in SVG user units (y down)."""
    p = parse_path(d)
    polys = []
    for sub in p.continuous_subpaths():
        L = sub.length(error=1e-4)
        n = max(min_pts, int(L * samples_per_unit))
        ts = np.linspace(0, 1, n)
        pts = np.array([[sub.point(sub.ilength(t*L, s_tol=1e-6)).real,
                         sub.point(sub.ilength(t*L, s_tol=1e-6)).imag] for t in ts])
        polys.append(pts)
    return polys

def polyline_len(pts):
    return float(np.sum(np.hypot(*np.diff(pts, axis=0).T)))

def normalize(polys, flip_y=True):
    """Center on centroid of bbox, scale so max dimension = 1.0, y-up."""
    allp = np.vstack(polys)
    lo, hi = allp.min(0), allp.max(0)
    ctr = (lo + hi) / 2.0
    scale = float((hi - lo).max())
    out = []
    for p in polys:
        q = (p - ctr) / scale
        if flip_y:
            q = q * np.array([1.0, -1.0])
        out.append(q)
    return out
