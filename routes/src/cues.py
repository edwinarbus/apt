"""Turn-by-turn cue sheets from a node path."""
import math
import numpy as np
from graph import ll_to_xy

FT_MI = 5280.0


def edge_way(g, a, b):
    for (j, ln, mult, wid) in g.nbrs[a]:
        if j == b: return wid
    return None


def street_of(g, wid):
    if wid is None: return "path"
    n = (g.way_name.get(wid) or "").strip()
    if n: return n
    t = g.way_tags.get(wid, {})
    hw = t.get("highway", "")
    return {"footway": "footpath", "path": "path", "steps": "steps",
            "cycleway": "bike path", "service": "service road",
            "pedestrian": "walkway"}.get(hw, "unnamed street")


def bearing(g, a, b):
    return math.degrees(math.atan2(g.X[b] - g.X[a], g.Y[b] - g.Y[a])) % 360.0


def turn_word(d):
    d = (d + 180) % 360 - 180
    if abs(d) < 26:  return "Continue on"
    if abs(d) > 150: return "Turn around onto"
    if d > 0:  return "Sharp right on" if d > 115 else ("Turn right on" if d > 62 else "Bear right on")
    return "Sharp left on" if d < -115 else ("Turn left on" if d < -62 else "Bear left on")


GENERIC = ("path", "footpath", "unnamed street", "service road", "walkway",
           "bike path", "steps", "track")

_NAMED = {}


def named_road_lookup(g):
    """KD-tree over named-road segments, to give unnamed sidewalks and paths the
    name of the street they actually run along."""
    if _NAMED:
        return _NAMED
    import numpy as np
    from scipy.spatial import cKDTree
    pts, names = [], []
    seen = set()
    for i, lst in enumerate(g.nbrs):
        for (j, ln, mult, wid) in lst:
            if j <= i or (i, j) in seen:
                continue
            seen.add((i, j))
            nm = street_of(g, wid)
            if not nm or nm in GENERIC:
                continue
            n = max(2, int(ln / 60) + 1)
            t = np.linspace(0, 1, n)
            pts.append(np.c_[g.X[i] + t * (g.X[j] - g.X[i]),
                             g.Y[i] + t * (g.Y[j] - g.Y[i])])
            names += [nm] * n
    P = np.vstack(pts)
    _NAMED.update(tree=cKDTree(P), names=names)
    return _NAMED


def resolve_name(g, nm, a, b, max_ft=90.0):
    """Replace a generic way name with the nearest real street name."""
    if nm not in GENERIC:
        return nm, False
    import numpy as np
    L = named_road_lookup(g)
    mid = [(g.X[a] + g.X[b]) / 2.0, (g.Y[a] + g.Y[b]) / 2.0]
    d, i = L["tree"].query(mid)
    if d <= max_ft:
        return L["names"][int(i)], True
    return nm, False


def cue_sheet(g, nodes, min_ft=140.0):
    """Collapse the node path into street-name legs with turn directions."""
    legs = []
    for a, b in zip(nodes[:-1], nodes[1:]):
        wid = edge_way(g, a, b)
        nm, _ = resolve_name(g, street_of(g, wid), a, b)
        d = float(math.hypot(g.X[b] - g.X[a], g.Y[b] - g.Y[a]))
        if legs and legs[-1]["street"] == nm:
            legs[-1]["ft"] += d; legs[-1]["end"] = b
        else:
            legs.append(dict(street=nm, ft=d, start=a, end=b))
    # fold away blips shorter than a few car-lengths
    out = []
    for L in legs:
        if out and L["ft"] < min_ft and len(legs) > 2:
            out[-1]["ft"] += L["ft"]; out[-1]["end"] = L["end"]; continue
        if out and out[-1]["street"] == L["street"]:
            out[-1]["ft"] += L["ft"]; out[-1]["end"] = L["end"]; continue
        out.append(L)
    cues = []
    prev_b = None
    for i, L in enumerate(out):
        b0 = bearing(g, L["start"], L["end"])
        if i == 0:
            word = "Start on"
        else:
            word = turn_word(b0 - prev_b)
        cues.append(dict(n=i + 1, word=word, street=L["street"], ft=L["ft"],
                         mi=L["ft"] / FT_MI, lat=float(g.lat[L["start"]]),
                         lon=float(g.lon[L["start"]])))
        prev_b = bearing(g, L["start"], L["end"])
    # cumulative
    c = 0.0
    for q in cues:
        q["cum_mi"] = c; c += q["mi"]
    return cues


def cross_street(g, nid, exclude=None, k=6):
    """Best-guess name of the cross street at a node, for 'start at X and Y'."""
    names = []
    for (j, ln, mult, wid) in g.nbrs[nid]:
        nm = street_of(g, wid)
        if nm and nm != exclude and nm not in names:
            names.append(nm)
    return names[:k]


def describe_point(g, nid):
    names = []
    for (j, ln, mult, wid) in g.nbrs[nid]:
        nm, _ = resolve_name(g, street_of(g, wid), nid, j)
        if nm not in names and nm not in GENERIC:
            names.append(nm)
    if len(names) >= 2: return f"{names[0]} & {names[1]}"
    if names: return names[0]
    return f"{g.lat[nid]:.5f}, {g.lon[nid]:.5f}"


def named_streets_at(g, nid):
    out = []
    for (j, ln, mult, wid) in g.nbrs[nid]:
        nm, _ = resolve_name(g, street_of(g, wid), nid, j)
        if nm and nm not in out and nm not in GENERIC:
            out.append(nm)
    return out


def best_start(g, nodes, prefer_xy=None, max_pref_ft=2000.0):
    """Rotate a closed loop to begin at a real, named intersection.

    Prefers a corner near `prefer_xy` (a bakery, or the chosen start) when one is close.
    """
    import numpy as np
    body = nodes[:-1] if nodes[0] == nodes[-1] else nodes[:]
    best, best_score = 0, None
    for k, nid in enumerate(body):
        names = named_streets_at(g, nid)
        if len(names) < 2:
            continue
        score = 0.0
        if prefer_xy is not None:
            d = float(np.hypot(g.X[nid] - prefer_xy[0], g.Y[nid] - prefer_xy[1]))
            score = d if d < max_pref_ft else max_pref_ft + d * 0.01
        if best_score is None or score < best_score:
            best_score, best = score, k
    if nodes[0] == nodes[-1]:
        return body[best:] + body[:best] + [body[best]]
    return nodes
