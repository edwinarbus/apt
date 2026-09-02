"""Turn the official logo outlines into drawable stroke sets for GPS art.

A "stroke" is a polyline in normalized logo space: centered on the origin,
max bounding dimension = 1.0, y-up. Routes scale this by `width_mi`.
"""
import numpy as np
from scipy.signal import find_peaks
from logo_geom import load_svg_paths, path_to_polys, normalize, polyline_len


def rdp(pts, eps):
    """Ramer-Douglas-Peucker simplification."""
    pts = np.asarray(pts, float)
    if len(pts) < 3: return pts
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1: continue
        a, b = pts[i], pts[j]
        ab = b - a; L = np.hypot(*ab)
        if L < 1e-12:
            d = np.hypot(*(pts[i+1:j] - a).T)
        else:
            d = np.abs(np.cross(np.tile(ab, (j-i-1, 1)), pts[i+1:j] - a)) / L
        k = int(np.argmax(d))
        if d[k] > eps:
            k += i + 1; keep[k] = True
            stack += [(i, k), (k, j)]
    return pts[keep]


class Stroke:
    def __init__(self, pts, name, closed=False, kind="outline", weight=1.0):
        self.pts = np.asarray(pts, float)
        self.name = name; self.closed = closed; self.kind = kind; self.weight = weight
    def __repr__(self):
        return f"<Stroke {self.name} n={len(self.pts)} len={polyline_len(self.pts):.3f}>"


# ---------------------------------------------------------------- Anthropic

def anthropic_strokes(svg="logos/si_anthropic.svg", simplify=0.004):
    vb, ds = load_svg_paths(svg)
    polys = []
    for d in ds:
        polys += path_to_polys(d, samples_per_unit=30)
    polys = normalize(polys)
    # identify subpaths: slash (rightmost centroid), A-outer (largest area), counter (inside A)
    def area(p):
        x, y = p[:, 0], p[:, 1]
        return abs(0.5 * np.sum(x[:-1]*y[1:] - x[1:]*y[:-1]))
    order = sorted(range(len(polys)), key=lambda i: -area(polys[i]))
    a_outer = polys[order[0]]
    rest = [polys[i] for i in order[1:]]
    rest.sort(key=lambda p: p[:, 0].mean())          # leftmost = counter, rightmost = slash
    counter, slash = rest[0], rest[-1]
    mk = lambda p, n: Stroke(rdp(p, simplify), n, closed=True, kind="outline")
    return [mk(a_outer, "A-outline"), mk(counter, "A-counter"), mk(slash, "slash")]


def anthropic_centerline(svg="logos/si_anthropic.svg"):
    """Skeleton version: the A drawn as two legs + crossbar, plus the slash's spine."""
    s = anthropic_strokes(svg, simplify=0.002)
    A, C, S = s[0].pts, s[1].pts, s[2].pts
    top = A[A[:, 1] > A[:, 1].max() - 1e-3]
    apex = np.array([top[:, 0].mean(), A[:, 1].max()])
    ybot = A[:, 1].min()
    bot = A[A[:, 1] < ybot + 1e-3]
    bl = np.array([bot[:, 0].min(), ybot]); br = np.array([bot[:, 0].max(), ybot])
    # crossbar at the counter's base
    ycb = C[:, 1].min()
    left_leg = np.array([apex + [-0.045, 0], bl + [0.055, 0]])
    right_leg = np.array([apex + [0.045, 0], br + [-0.055, 0]])
    def x_on(seg, y):
        (x1, y1), (x2, y2) = seg
        return x1 + (x2 - x1) * (y - y1) / (y2 - y1)
    cross = np.array([[x_on(left_leg, ycb), ycb], [x_on(right_leg, ycb), ycb]])
    stop = S[S[:, 1] > S[:, 1].max() - 1e-3][:, 0].mean()
    sbot = S[S[:, 1] < S[:, 1].min() + 1e-3][:, 0].mean()
    spine = np.array([[stop, S[:, 1].max()], [sbot, S[:, 1].min()]])
    return [Stroke(left_leg, "A-left-leg", kind="center"),
            Stroke(right_leg, "A-right-leg", kind="center"),
            Stroke(cross, "A-crossbar", kind="center"),
            Stroke(spine, "slash", kind="center")]


# ------------------------------------------------------------------- Claude

def _claude_raw(svg="logos/si_claude.svg"):
    vb, ds = load_svg_paths(svg)
    polys = []
    for d in ds:
        polys += path_to_polys(d, samples_per_unit=40)
    P = normalize(polys)[0]
    x, y = P[:, 0], P[:, 1]
    a = 0.5 * np.sum(x[:-1]*y[1:] - x[1:]*y[:-1])
    cx = np.sum((x[:-1]+x[1:]) * (x[:-1]*y[1:] - x[1:]*y[:-1])) / (6*a)
    cy = np.sum((y[:-1]+y[1:]) * (x[:-1]*y[1:] - x[1:]*y[:-1])) / (6*a)
    ctr = np.array([cx, cy])
    P = P - ctr                                  # re-center on the burst's hub
    r = np.hypot(P[:, 0], P[:, 1])
    n = len(r); rr = np.concatenate([r, r])
    tips = sorted({int(i) % n for i in find_peaks(rr, distance=n//30, prominence=0.05)[0]})
    vals = sorted({int(i) % n for i in find_peaks(-rr, distance=n//30, prominence=0.05)[0]})
    return P, r, tips, vals


def claude_rays(svg="logos/si_claude.svg"):
    """Return per-ray info sorted by angle: (tip_index, tip_xy, radius, angle_deg)."""
    P, r, tips, vals = _claude_raw(svg)
    out = []
    for i in tips:
        out.append(dict(i=i, xy=P[i], r=float(r[i]),
                        ang=float(np.degrees(np.arctan2(P[i, 1], P[i, 0])))))
    out.sort(key=lambda d: d["ang"])
    return P, vals, out


def claude_outline(svg="logos/si_claude.svg", keep_rays=None, simplify=0.004):
    """Closed outline of the burst. keep_rays = list of ray indices (by angle order)
    to retain; dropped rays are replaced by a chord across the hub."""
    P, vals, rays = claude_rays(svg)
    n = len(P)
    if keep_rays is None:
        return [Stroke(rdp(P, simplify), "burst", closed=True, kind="outline")]
    # Each ray owns the arc between the valley before and after its tip.
    vals_sorted = sorted(vals)
    def valley_before(i):
        c = [v for v in vals_sorted if v < i]
        return c[-1] if c else vals_sorted[-1]
    def valley_after(i):
        c = [v for v in vals_sorted if v > i]
        return c[0] if c else vals_sorted[0]
    keep = set(keep_rays)
    # Walk the rays in outline-traversal order, not angle order, so the
    # reconstructed boundary stays a single continuous loop.
    order = sorted(range(len(rays)), key=lambda k: rays[k]["i"])
    pts = []
    for k in order:
        ray = rays[k]
        v0, v1 = valley_before(ray["i"]), valley_after(ray["i"])
        arc = P[v0:v1+1] if v0 < v1 else np.vstack([P[v0:], P[:v1+1]])
        pts.append(arc if k in keep else np.vstack([P[v0], P[v1]]))
    out = np.vstack(pts)
    out = np.vstack([out, out[:1]])
    return [Stroke(rdp(out, simplify), "burst", closed=True, kind="outline")]


def claude_spokes(svg="logos/si_claude.svg", keep_rays=None, hub=0.0):
    """Each ray as an out-and-back radial line from the hub to the tip."""
    P, vals, rays = claude_rays(svg)
    keep = set(range(len(rays))) if keep_rays is None else set(keep_rays)
    out = []
    for k, ray in enumerate(rays):
        if k not in keep: continue
        tip = ray["xy"]; u = tip / np.hypot(*tip)
        out.append(Stroke(np.array([u*hub, tip]), f"ray{k:02d}@{ray['ang']:.0f}deg",
                          kind="spoke", weight=ray["r"]))
    return out


if __name__ == "__main__":
    import os
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for nm, fn in [("anthropic-outline", anthropic_strokes),
                   ("anthropic-center", anthropic_centerline),
                   ("claude-outline", claude_outline),
                   ("claude-spokes", claude_spokes)]:
        ss = fn(); tot = sum(polyline_len(s.pts) for s in ss)
        print(f"{nm:20s} strokes={len(ss):2d} total_norm_len={tot:6.3f}"
              f"   -> at 0.8mi wide = {tot*0.8:5.2f} mi ideal")


def pick_rays(rays, k):
    """Drop rays greedily, keeping the burst's angular spread as even as possible."""
    keep = list(range(len(rays)))
    while len(keep) > k:
        best, bestv = None, None
        for i in keep:
            a = sorted(rays[j]["ang"] for j in keep if j != i)
            v = float(np.std(np.diff(a + [a[0] + 360])))
            if bestv is None or v < bestv: bestv, best = v, i
        keep.remove(best)
    return sorted(keep)


def claude_star(svg="logos/si_claude.svg", keep_rays=None, hub_r=0.145):
    """The burst as a closed star polygon: out to each tip, back to the hub ring.

    At any size that fits a 10K, the real outline's ray flanks sit closer than one
    SF block, so the drawing collapses to exactly this. Modelling it directly keeps
    the tapered rays and the open hub the logo actually has.
    """
    P, vals, rays = claude_rays(svg)
    idx = sorted(range(len(rays))) if keep_rays is None else sorted(keep_rays)
    kept = [rays[i] for i in idx]
    kept.sort(key=lambda r: r["ang"])
    n = len(kept)
    pts = []
    for i, ray in enumerate(kept):
        nxt = kept[(i + 1) % n]
        a0 = np.radians(ray["ang"]); a1 = np.radians(nxt["ang"])
        d = (a1 - a0) % (2 * np.pi)
        mid = a0 + d / 2.0
        tip = ray["xy"]
        pts.append(tip)
        pts.append(np.array([hub_r * np.cos(mid), hub_r * np.sin(mid)]))
    pts.append(pts[0])
    return [Stroke(np.array(pts), "burst", closed=True, kind="star")]


def claude_true_outline(svg="logos/si_claude.svg", keep_rays=None, simplify=0.0022):
    """The mark's actual boundary — tapered rays with rounded tips and the concave
    valleys between them — rather than the straight-edged star approximation.

    `simplify` is deliberately tight so the taper and the tips survive; the street
    snapper will coarsen it soon enough.
    """
    return claude_outline(svg=svg, keep_rays=keep_rays, simplify=simplify)


def ray_width_profile(svg="logos/si_claude.svg", n=24):
    """For each ray: perpendicular flank separation sampled along its length.

    Tells you how wide the drawing must be before the two sides of a ray can land
    on different streets instead of collapsing onto one.
    """
    P, vals, rays = claude_rays(svg)
    vs = sorted(vals)
    out = []
    for k, ray in enumerate(rays):
        i = ray["i"]
        before = [v for v in vs if v < i] or [vs[-1]]
        after = [v for v in vs if v > i] or [vs[0]]
        v0, v1 = before[-1], after[0]
        arc = P[v0:v1 + 1] if v0 < v1 else np.vstack([P[v0:], P[:v1 + 1]])
        tip = ray["xy"]
        u = tip / np.hypot(*tip)                      # ray axis
        perp = np.array([-u[1], u[0]])
        r = arc @ u                                   # distance along the axis
        w = arc @ perp                                # signed offset across it
        rr = np.linspace(r.min(), r.max(), n)
        widths = []
        for j in range(n - 1):
            m = (r >= rr[j]) & (r < rr[j + 1])
            if m.sum() >= 2:
                widths.append((0.5 * (rr[j] + rr[j + 1]), float(w[m].max() - w[m].min())))
        out.append(dict(k=k, ang=ray["ang"], r_tip=ray["r"], widths=widths))
    return out
