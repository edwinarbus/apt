"""Match bakery POIs to a route."""
import json
import numpy as np
from graph import ll_to_xy

JUNK = ("ihop", "pizza", "mcdonald", "starbucks", "dunkin", "7-eleven", "walgreens",
        "safeway", "whole foods", "target", "subway", "burger", "taco", "chicken",
        "liquor", "market", "deli & ", "grocery")


def load(path="data/bakeries.json"):
    rows = json.load(open(path))
    out = []
    for r in rows:
        n = r["name"].lower()
        if any(j in n for j in JUNK): continue
        out.append(r)
    return out


def near_route(latlon, rows, max_ft=600.0):
    X, Y = ll_to_xy(latlon[:, 0], latlon[:, 1])
    P = np.c_[X, Y]
    from scipy.spatial import cKDTree
    t = cKDTree(P)
    hits = []
    for r in rows:
        x, y = ll_to_xy(r["lat"], r["lon"])
        d, i = t.query([x, y])
        if d <= max_ft:
            hits.append(dict(**r, dist_ft=float(d), at_mi=None, idx=int(i)))
    hits.sort(key=lambda h: h["dist_ft"])
    return hits
