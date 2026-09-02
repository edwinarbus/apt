"""Turn a chosen route record into the full deliverable set."""
import json, os, sys
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from graph import ll_to_xy
from gpx import write_gpx, dedupe
from cues import cue_sheet, describe_point, best_start, named_streets_at
from elevation import query as elev_query, profile, grade_stats
from bakeries import load as load_bakeries, near_route
from render import strava_preview

FT_MI = 5280.0


def finalize(rec, slug, name, area, logo, note="", bakery_ft=700.0, do_elev=True,
             prefer_ll=None):
    c = load(); g = c['g']
    nodes = rec["nodes"]
    # start the loop at a real, named intersection (near `prefer_ll` when given)
    pxy = None
    if prefer_ll is not None:
        px, py = ll_to_xy(prefer_ll[0], prefer_ll[1]); pxy = (float(px), float(py))
    nodes = best_start(g, nodes, prefer_xy=pxy)
    latlon = np.array([[g.lat[i], g.lon[i]] for i in nodes])
    ll = dedupe(latlon, 6.0)

    # Distance on the sphere, the way Strava will measure it; the planar
    # projection used for routing runs ~0.3% short.
    X, Y = ll_to_xy(ll[:, 0], ll[:, 1])
    R_FT = 20902231.0
    la = np.radians(ll[:, 0]); lo = np.radians(ll[:, 1])
    dla = np.diff(la); dlo = np.diff(lo)
    h = np.sin(dla / 2) ** 2 + np.cos(la[:-1]) * np.cos(la[1:]) * np.sin(dlo / 2) ** 2
    seg = 2 * R_FT * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    dist_mi = float(seg.sum() / FT_MI)

    # elevation: sample every ~120 ft to keep the API call reasonable
    cum = np.r_[0.0, np.cumsum(seg)]
    want = np.arange(0, cum[-1], 120.0)
    idx = np.unique(np.searchsorted(cum, want).clip(0, len(ll) - 1))
    if do_elev:
        z_s = elev_query(ll[idx])
        ele = np.interp(cum, cum[idx], z_s)
    else:
        from ctx import elev_ft
        ele = elev_ft(ll[:, 0], ll[:, 1])
    prof = profile(ll, ele, xy=(X, Y))
    gr = grade_stats(X, Y, prof["ele"])

    cues = cue_sheet(g, nodes)
    start = describe_point(g, nodes[0])

    bk = near_route(ll, load_bakeries(), max_ft=bakery_ft)
    for b in bk:
        b["at_mi"] = float(cum[min(b["idx"], len(cum) - 1)] / FT_MI)

    out = dict(slug=slug, name=name, area=area, logo=logo, note=note,
               dist_mi=dist_mi, gain_ft=prof["gain"], loss_ft=prof["loss"],
               lo_ft=prof["lo"], hi_ft=prof["hi"], grade=gr,
               start=start, start_ll=[float(ll[0, 0]), float(ll[0, 1])],
               width_mi=rec["width_ft"] / FT_MI, rot=rec["rot"],
               center=rec["center"], n_pts=len(ll),
               iou=rec.get("iou"),
               rays=rec.get("rays"), hub=rec.get("hub"),
               cues=cues, bakeries=bk)
    def _plain(o):
        if isinstance(o, dict): return {k: _plain(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)): return [_plain(v) for v in o]
        if isinstance(o, np.generic): return o.item()
        if isinstance(o, np.ndarray): return _plain(o.tolist())
        return o
    out = _plain(out)
    os.makedirs("out/routes", exist_ok=True)
    write_gpx(f"out/routes/{slug}.gpx", ll, prof["ele"], name=name,
              desc=f"{name} — {dist_mi:.2f} mi, {prof['gain']:.0f} ft gain. {note}")
    np.save(f"out/routes/{slug}_ll.npy", ll)
    json.dump(out, open(f"out/routes/{slug}.json", "w"), indent=1)
    return out, ll, prof["ele"]
