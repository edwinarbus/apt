"""Assemble a full runnable route from placed logo strokes."""
import itertools
import numpy as np
from graph import ll_to_xy, xy_to_ll
from snap import Snapper
from place import transform, FT_PER_MI


def stroke_corners(pts):
    c = np.asarray(pts, float)
    if len(c) > 2 and np.allclose(c[0], c[-1]):
        return c[:-1], True
    return c, False


def snap_logo(sn, strokes, center_xy, width_ft, rot_deg, k=4, **kw):
    polys = transform(strokes, center_xy, width_ft, rot_deg)
    out = []
    for s, poly in zip(strokes, polys):
        corners, closed = stroke_corners(poly)
        if closed:
            seq = np.vstack([corners, corners[:1]])
            legs = snap_closed(sn, seq, k=k, **kw)
        else:
            seq = corners
            legs = sn.snap_stroke(seq, k=k, **kw)
        if legs is None:
            return None
        nodes = [legs[0][0][0]]
        for path, w in legs:
            nodes += list(path[1:])
        out.append(dict(name=s.name, nodes=nodes, closed=closed, ideal=poly,
                        kind=getattr(s, "kind", "outline")))
    return out


def snap_closed(sn, seq, k=4, **kw):
    best, bestc = None, float("inf")
    for j0, d0 in sn.candidates(seq[0], k=k):
        legs = sn.snap_stroke_fixed(seq, j0, **kw)
        if legs is None: continue
        c = sum(sn._plen(p) for p, _ in legs)
        if c < bestc: bestc, best = c, legs
    return best


def route_points(g, nodes):
    return np.array([[g.lat[i], g.lon[i]] for i in nodes])


def path_len_ft(g, nodes):
    p = np.asarray(nodes)
    return float(np.sum(np.hypot(np.diff(g.X[p]), np.diff(g.Y[p]))))


def _rotate_cycle(nodes, start_pos):
    """Re-enter a closed loop at a different node (cycle: nodes[0]==nodes[-1])."""
    body = nodes[:-1]
    n = len(body)
    k = start_pos % n
    return body[k:] + body[:k] + [body[k]]


def assemble(sn, snapped, close_loop=True, try_orders=True, reuse_discount=0.12,
             n_entry=10, n_join=24):
    """Chain strokes into one run.

    Chooses the stroke order, where to enter each closed loop, and which way to
    run open strokes, so that the joins between strokes are short and hug ink the
    drawing already lays down (Strava overdraws it, so retraced joins stay
    invisible)."""
    from scipy.spatial import cKDTree
    g = sn.g
    used = set()
    for s in snapped:
        for a, b in zip(s["nodes"][:-1], s["nodes"][1:]):
            used.add((min(a, b), max(a, b)))
    ink = np.vstack([np.c_[g.X[np.array(s["nodes"])], g.Y[np.array(s["nodes"])]]
                     for s in snapped])
    ink_tree = cKDTree(ink)
    cache = {}

    def conn(a, b):
        if a == b: return [], 0.0
        if (a, b) in cache: return cache[(a, b)]
        r = sn.shortest_hug(a, b, ink_tree=ink_tree, used_edges=used,
                            reuse_discount=reuse_discount)
        out = (None, float("inf")) if r is None else (r[0], path_len_ft(g, r[0]))
        cache[(a, b)] = out
        return out

    def entries(nodes, closed, n):
        if not closed: return [0]
        body = nodes[:-1]
        step = max(1, len(body) // n)
        return list(range(0, len(body), step))

    idxs = list(range(len(snapped)))
    orders = (list(itertools.permutations(idxs))
              if (try_orders and len(idxs) <= 4) else [tuple(idxs)])
    best = None
    for order in orders:
        first = snapped[order[0]]
        for e0 in entries(first["nodes"], first["closed"], n_entry):
            chain, total_conn, ok = [], 0.0, True
            nd0 = list(first["nodes"])
            if first["closed"] and e0:
                nd0 = _rotate_cycle(nd0, e0)
            chain.append([order[0], nd0, []])
            for si in order[1:]:
                s = snapped[si]
                nd = list(s["nodes"])
                prev_end = chain[-1][1][-1]
                if s["closed"]:
                    body = nd[:-1]
                    bk, bc, bp = None, float("inf"), None
                    for k in entries(nd, True, n_join):
                        p, L = conn(prev_end, body[k])
                        if L < bc: bk, bc, bp = k, L, p
                    if bk is None: ok = False; break
                    chain.append([si, _rotate_cycle(nd, bk), bp]); total_conn += bc
                else:
                    p1, L1 = conn(prev_end, nd[0])
                    p2, L2 = conn(prev_end, nd[-1])
                    if min(L1, L2) == float("inf"): ok = False; break
                    if L2 < L1: chain.append([si, nd[::-1], p2]); total_conn += L2
                    else:       chain.append([si, nd, p1]);       total_conn += L1
            if not ok: continue
            tailpath, tail = ([], 0.0)
            if close_loop:
                tailpath, tail = conn(chain[-1][1][-1], chain[0][1][0])
                if tail == float("inf"): continue
            tot = sum(path_len_ft(g, c[1]) for c in chain) + total_conn + tail
            if best is None or tot < best[0]:
                best = (tot, chain, tailpath, total_conn + tail)
    if best is None: return None
    tot, chain, tailpath, connlen = best
    full = list(chain[0][1])
    for c in chain[1:]:
        if c[2]: full += list(c[2][1:])
        full += list(c[1][1:]) if full[-1] == c[1][0] else list(c[1])
    if tailpath: full += list(tailpath[1:])
    return full, connlen


def shape_match(g, nodes, ideal_polys, width_ft, step=45.0):
    """Symmetric chamfer distance between the run and the ideal logo, as a
    fraction of logo width. Punishes both stray ink and missed strokes."""
    from scipy.spatial import cKDTree
    from place import sample_strokes
    p = np.asarray(nodes)
    R = np.c_[g.X[p], g.Y[p]]
    Rd = []
    for a, b in zip(R[:-1], R[1:]):
        L = float(np.hypot(*(b - a)))
        n = max(2, int(L / step) + 1)
        t = np.linspace(0, 1, n)[:, None]
        Rd.append(a + t * (b - a))
    Rd = np.vstack(Rd)
    I = sample_strokes(ideal_polys, step)
    ti, tr = cKDTree(I), cKDTree(Rd)
    d_ri, _ = ti.query(Rd)      # stray ink: route far from any ideal stroke
    d_ir, _ = tr.query(I)       # coverage: ideal stroke with no route near it
    return dict(stray=float(d_ri.mean()) / width_ft,
                cover=float(d_ir.mean()) / width_ft,
                stray_p90=float(np.percentile(d_ri, 90)) / width_ft,
                match=float(d_ri.mean() + d_ir.mean()) / width_ft)
