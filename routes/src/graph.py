"""Runnable street graph for San Francisco, built from Overpass JSON."""
import json, math, pickle, os
import numpy as np
from collections import defaultdict

FT_PER_M = 3.280839895
LAT0 = 37.7599  # SF reference latitude for the local planar projection

def ll_to_xy(lat, lon, lat0=LAT0, lon0=-122.4400):
    """Local equirectangular projection -> feet. Good to <0.1% over SF."""
    k = math.cos(math.radians(lat0))
    x = (np.asarray(lon) - lon0) * 111320.0 * k * FT_PER_M
    y = (np.asarray(lat) - lat0) * 110574.0 * FT_PER_M
    return x, y

def xy_to_ll(x, y, lat0=LAT0, lon0=-122.4400):
    k = math.cos(math.radians(lat0))
    lon = np.asarray(x) / (111320.0 * k * FT_PER_M) + lon0
    lat = np.asarray(y) / (110574.0 * FT_PER_M) + lat0
    return lat, lon

# Ways we refuse to route on at all.
BAD_HIGHWAY = {"motorway", "motorway_link", "trunk", "trunk_link", "construction", "proposed", "raceway"}
# Multiplier on length: >1 means "avoid unless helpful". Runnable but less pleasant.
SURFACE_COST = {
    "footway": 1.00, "path": 1.05, "pedestrian": 1.00, "living_street": 1.00,
    "residential": 1.00, "unclassified": 1.05, "tertiary": 1.10, "tertiary_link": 1.15,
    "secondary": 1.35, "secondary_link": 1.4, "primary": 1.9, "primary_link": 1.95,
    "cycleway": 1.10, "service": 1.25, "track": 1.3, "steps": 6.0,
}

class StreetGraph:
    def __init__(self):
        self.node_ll = {}          # nid -> (lat, lon)
        self.adj = defaultdict(list)  # nid -> [(nbr, length_ft, cost_mult, way_id)]
        self.way_name = {}         # way_id -> street name
        self.way_tags = {}

    @classmethod
    def from_overpass(cls, path):
        g = cls()
        raw = json.load(open(path))
        nodes, ways = {}, []
        for el in raw["elements"]:
            if el["type"] == "node":
                nodes[el["id"]] = (el["lat"], el["lon"])
            elif el["type"] == "way":
                ways.append(el)
        used = set()
        for w in ways:
            t = w.get("tags", {})
            hw = t.get("highway")
            if not hw or hw in BAD_HIGHWAY:
                continue
            if t.get("foot") in ("no", "private") or t.get("access") in ("private", "no"):
                continue
            if t.get("area") == "yes":
                continue
            mult = SURFACE_COST.get(hw, 1.2)
            if t.get("footway") == "crossing" or t.get("highway") == "steps":
                pass
            nd = [n for n in w["nodes"] if n in nodes]
            if len(nd) < 2:
                continue
            wid = w["id"]
            g.way_name[wid] = t.get("name", "")
            g.way_tags[wid] = t
            for a, b in zip(nd[:-1], nd[1:]):
                la, lo = nodes[a]; lb, lob = nodes[b]
                xa, ya = ll_to_xy(la, lo); xb, yb = ll_to_xy(lb, lob)
                d = float(math.hypot(xb - xa, yb - ya))
                if d <= 0: continue
                g.adj[a].append((b, d, mult, wid))
                g.adj[b].append((a, d, mult, wid))
                used.add(a); used.add(b)
        g.node_ll = {n: nodes[n] for n in used}
        return g

    def finalize(self):
        """Freeze to arrays + a KD-tree for nearest-node queries."""
        from scipy.spatial import cKDTree
        self.ids = np.array(sorted(self.node_ll))
        self.idx = {n: i for i, n in enumerate(self.ids)}
        lat = np.array([self.node_ll[n][0] for n in self.ids])
        lon = np.array([self.node_ll[n][1] for n in self.ids])
        self.lat, self.lon = lat, lon
        self.X, self.Y = ll_to_xy(lat, lon)
        self.tree = cKDTree(np.c_[self.X, self.Y])
        # CSR-ish adjacency on integer indices
        head = [[] for _ in range(len(self.ids))]
        for n, lst in self.adj.items():
            i = self.idx[n]
            for (m, d, mult, wid) in lst:
                if m in self.idx:
                    head[i].append((self.idx[m], d, mult, wid))
        self.nbrs = head
        return self

    def largest_component(self):
        """Keep only the biggest connected component (drops islands/parse debris)."""
        n = len(self.ids); seen = np.zeros(n, bool); best = []
        for s in range(n):
            if seen[s]: continue
            stack, comp = [s], []
            seen[s] = True
            while stack:
                u = stack.pop(); comp.append(u)
                for (v, *_ ) in self.nbrs[u]:
                    if not seen[v]:
                        seen[v] = True; stack.append(v)
            if len(comp) > len(best): best = comp
        keep = np.zeros(n, bool); keep[best] = True
        return keep

if __name__ == "__main__":
    import sys
    g = StreetGraph.from_overpass(sys.argv[1]).finalize()
    print(f"nodes={len(g.ids)}  edges={sum(len(x) for x in g.nbrs)//2}")
    keep = g.largest_component()
    print(f"largest component: {keep.sum()} nodes ({100*keep.sum()/len(g.ids):.1f}%)")
    with open(sys.argv[2], "wb") as f:
        pickle.dump(g, f, protocol=4)
    print("saved", sys.argv[2])
