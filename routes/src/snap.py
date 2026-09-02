"""Snap idealized logo strokes onto the real street graph.

Each stroke is split at its corner vertices into "legs". Every leg is routed
with a corridor-restricted Dijkstra whose edge cost penalises straying from the
ideal segment, so the resulting path hugs the intended line instead of merely
taking the shortest way between the endpoints.
"""
import heapq, math
import numpy as np
from graph import ll_to_xy, xy_to_ll


def seg_dist(P, a, b):
    """Perpendicular distance from points P (N,2) to segment a-b, plus the
    projection parameter t in [0,1]."""
    ab = b - a; L2 = float(ab @ ab)
    if L2 < 1e-9:
        return np.hypot(*(P - a).T), np.zeros(len(P))
    t = np.clip((P - a) @ ab / L2, 0, 1)
    proj = a + t[:, None] * ab
    return np.hypot(*(P - proj).T), t


class Snapper:
    def __init__(self, g, keep_mask=None):
        self.g = g
        self.ok = np.ones(len(g.ids), bool) if keep_mask is None else keep_mask

    def candidates(self, xy, k=6, radius=450.0):
        """Graph nodes near an ideal corner point."""
        d, i = self.g.tree.query(xy, k=min(k * 4, 40))
        out = [(int(j), float(dd)) for dd, j in zip(np.atleast_1d(d), np.atleast_1d(i))
               if self.ok[j] and dd <= radius]
        return out[:k] if out else [(int(np.atleast_1d(i)[0]), float(np.atleast_1d(d)[0]))]

    def route_leg(self, src, dst, a, b, corridor=850.0, w_dev=9.0, dev_ref=260.0,
                  w_back=1.1, max_expand=200000, _widen=(1.0, 2.0, 4.0, 8.0)):
        """Dijkstra from node src to node dst, hugging segment a->b.

        The corridor is a hard cutoff, so a tight one can leave a leg with no
        feasible path at all. Rather than fail the whole placement, widen it and
        retry — the deviation penalty still keeps the result close to the line.
        """
        for f in _widen:
            r = self._route_leg_once(src, dst, a, b, corridor * f, w_dev, dev_ref,
                                     w_back, max_expand)
            if r is not None:
                return r
        return None

    def _route_leg_once(self, src, dst, a, b, corridor, w_dev, dev_ref,
                        w_back, max_expand):
        g = self.g
        X, Y = g.X, g.Y
        ab = b - a; L = float(np.hypot(*ab))
        if L < 1e-6: L = 1.0
        u = ab / L
        # Corridor = nodes within `corridor` of the segment (padded at the ends).
        lo = np.minimum(a, b) - corridor; hi = np.maximum(a, b) + corridor
        box = (X >= lo[0]) & (X <= hi[0]) & (Y >= lo[1]) & (Y <= hi[1]) & self.ok
        idxs = np.flatnonzero(box)
        if len(idxs) == 0: return None
        P = np.c_[X[idxs], Y[idxs]]
        dist_perp, t = seg_dist(P, a, b)
        inside = dist_perp <= corridor
        idxs, dist_perp, t = idxs[inside], dist_perp[inside], t[inside]
        if len(idxs) == 0: return None
        allow = np.zeros(len(X), bool); allow[idxs] = True
        dv = np.zeros(len(X)); dv[idxs] = dist_perp
        sv = np.zeros(len(X)); sv[idxs] = t * L
        allow[src] = allow[dst] = True

        INF = float("inf")
        best = {src: 0.0}; prev = {}
        pq = [(0.0, src)]; seen = set(); n_exp = 0
        while pq:
            c, v = heapq.heappop(pq)
            if v in seen: continue
            seen.add(v); n_exp += 1
            if v == dst: break
            if n_exp > max_expand: break
            for (w, ln, mult, wid) in g.nbrs[v]:
                if not allow[w] or w in seen: continue
                dev = 0.5 * (dv[v] + dv[w])
                step = ln * mult * (1.0 + w_dev * (dev / dev_ref) ** 2)
                ds = sv[w] - sv[v]
                if ds < 0: step += w_back * (-ds)
                nc = c + step
                if nc < best.get(w, INF):
                    best[w] = nc; prev[w] = (v, wid); heapq.heappush(pq, (nc, w))
        if dst not in best: return None
        path, wids = [dst], []
        cur = dst
        while cur != src:
            p, wid = prev[cur]; path.append(p); wids.append(wid); cur = p
        path.reverse(); wids.reverse()
        return path, wids

    def shortest(self, src, dst, used_edges=None, reuse_discount=0.12, max_expand=400000):
        """Plain shortest path, but cheap along edges the drawing already uses,
        so connectors retrace existing ink instead of adding new lines."""
        g = self.g
        INF = float("inf"); best = {src: 0.0}; prev = {}
        pq = [(0.0, src)]; seen = set(); n = 0
        while pq:
            c, v = heapq.heappop(pq)
            if v in seen: continue
            seen.add(v); n += 1
            if v == dst: break
            if n > max_expand: break
            for (w, ln, mult, wid) in g.nbrs[v]:
                if not self.ok[w] or w in seen: continue
                step = ln * mult
                if used_edges is not None and (min(v, w), max(v, w)) in used_edges:
                    step *= reuse_discount
                nc = c + step
                if nc < best.get(w, INF):
                    best[w] = nc; prev[w] = (v, wid); heapq.heappush(pq, (nc, w))
        if dst not in best: return None
        path, wids = [dst], []
        cur = dst
        while cur != src:
            p, wid = prev[cur]; path.append(p); wids.append(wid); cur = p
        path.reverse(); wids.reverse()
        return path, wids

    def snap_stroke(self, corners, k=4, **kw):
        """DP over candidate graph nodes for each ideal corner of one stroke."""
        cand = [self.candidates(c, k=k) for c in corners]
        n = len(corners)
        # states[i] = {node: (cost, backpointer, path_to_here)}
        cur = {j: (dd * 1.4, None, None, None) for j, dd in cand[0]}
        table = [cur]
        for i in range(1, n):
            nxt = {}
            for j, dd in cand[i]:
                bestc, bestp, bestpath, bestw = float("inf"), None, None, None
                for p, (pc, _, _, _) in table[-1].items():
                    r = self.route_leg(p, j, corners[i-1], corners[i], **kw)
                    if r is None: continue
                    path, wids = r
                    seglen = self._plen(path)
                    ideal = float(np.hypot(*(corners[i] - corners[i-1])))
                    dev = self._dev(path, corners[i-1], corners[i])
                    c = pc + seglen + 2.5 * dev + 0.8 * abs(seglen - ideal) + dd * 1.4
                    if c < bestc:
                        bestc, bestp, bestpath, bestw = c, p, path, wids
                if bestp is not None:
                    nxt[j] = (bestc, bestp, bestpath, bestw)
            if not nxt: return None
            table.append(nxt)
        end = min(table[-1], key=lambda j: table[-1][j][0])
        legs = []
        j = end
        for i in range(len(table) - 1, 0, -1):
            c, p, path, wids = table[i][j]
            legs.append((path, wids)); j = p
        legs.reverse()
        return legs

    def _plen(self, path):
        X, Y = self.g.X, self.g.Y
        p = np.array(path)
        return float(np.sum(np.hypot(np.diff(X[p]), np.diff(Y[p]))))

    def _dev(self, path, a, b):
        X, Y = self.g.X, self.g.Y
        p = np.array(path)
        d, _ = seg_dist(np.c_[X[p], Y[p]], a, b)
        return float(d.mean())


def _snap_stroke_fixed(self, corners, first_node, **kw):
    """Like snap_stroke but pinned to `first_node` at both ends (closed loops)."""
    n = len(corners)
    cand = [self.candidates(c, k=kw.pop("k", 4) if "k" in kw else 4) for c in corners]
    cand[0] = [(first_node, 0.0)]
    cand[-1] = [(first_node, 0.0)]
    table = [{first_node: (0.0, None, None, None)}]
    for i in range(1, n):
        nxt = {}
        for j, dd in cand[i]:
            bestc, bestp, bestpath, bestw = float("inf"), None, None, None
            for p, (pc, _, _, _) in table[-1].items():
                r = self.route_leg(p, j, corners[i-1], corners[i], **kw)
                if r is None: continue
                path, wids = r
                seglen = self._plen(path)
                ideal = float(np.hypot(*(corners[i] - corners[i-1])))
                dev = self._dev(path, corners[i-1], corners[i])
                c = pc + seglen + 2.5 * dev + 0.8 * abs(seglen - ideal) + dd * 1.4
                if c < bestc: bestc, bestp, bestpath, bestw = c, p, path, wids
            if bestp is not None: nxt[j] = (bestc, bestp, bestpath, bestw)
        if not nxt: return None
        table.append(nxt)
    end = min(table[-1], key=lambda j: table[-1][j][0])
    legs = []; j = end
    for i in range(len(table)-1, 0, -1):
        c, p, path, wids = table[i][j]
        legs.append((path, wids)); j = p
    legs.reverse()
    return legs

Snapper.snap_stroke_fixed = _snap_stroke_fixed


def _shortest_hug(self, src, dst, ink_tree=None, used_edges=None,
                  reuse_discount=0.12, w_hug=7.0, hug_ref=300.0, max_expand=400000):
    """Connector routing that prefers to retrace ink the drawing already lays
    down, and otherwise stays close to it, so joins stay invisible."""
    g = self.g
    INF = float("inf"); best = {src: 0.0}; prev = {}
    pq = [(0.0, src)]; seen = set(); n = 0
    X, Y = g.X, g.Y
    while pq:
        c, v = heapq.heappop(pq)
        if v in seen: continue
        seen.add(v); n += 1
        if v == dst: break
        if n > max_expand: break
        for (w, ln, mult, wid) in g.nbrs[v]:
            if not self.ok[w] or w in seen: continue
            step = ln * mult
            if used_edges is not None and (min(v, w), max(v, w)) in used_edges:
                step *= reuse_discount
            elif ink_tree is not None:
                d, _ = ink_tree.query([[0.5*(X[v]+X[w]), 0.5*(Y[v]+Y[w])]])
                step *= (1.0 + w_hug * (float(d[0]) / hug_ref) ** 2)
            nc = c + step
            if nc < best.get(w, INF):
                best[w] = nc; prev[w] = (v, wid); heapq.heappush(pq, (nc, w))
    if dst not in best: return None
    path, wids = [dst], []
    cur = dst
    while cur != src:
        p, wid = prev[cur]; path.append(p); wids.append(wid); cur = p
    path.reverse(); wids.reverse()
    return path, wids

Snapper.shortest_hug = _shortest_hug
