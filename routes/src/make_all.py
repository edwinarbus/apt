"""Generate every deliverable for the chosen routes."""
import sys, pickle, json, os
sys.path.insert(0, "src")
import numpy as np
from chosen_routes import CHOSEN, load_choice
from finalize import finalize
from render import strava_preview
from gpx import dedupe

ANCHOR = (37.7712, -122.4335)   # Duboce Triangle, a neighbourhood-level anchor for 'start nearby'
NEAR_ANCHOR = {"anthropic-panhandle", "anthropic-lower-haight-long"}

if __name__ == "__main__":
    do_elev = "--fast" not in sys.argv
    out = []
    for tag, idx, slug, name, area, logo, tier in CHOSEN:
        r = load_choice(tag, idx)
        pref = ANCHOR if slug in NEAR_ANCHOR else None
        info, ll, ele = finalize(r, slug, name, area, logo, do_elev=do_elev,
                                 prefer_ll=pref)
        info['tier'] = tier
        strava_preview(ll, f"out/routes/{slug}.jpg", px=1000, lw=6.4,
                       title=f"{name} — {info['dist_mi']:.2f} mi")
        out.append(info)
        print(f"{slug:26s} {info['dist_mi']:5.2f} mi  +{info['gain_ft']:4.0f} ft  "
              f"max grade {info['grade']['max_up']:4.1f}%  {len(info['cues'])} cues  "
              f"{len(info['bakeries'])} bakeries  start: {info['start']}")
    json.dump(out, open("out/routes/summary.json", "w"), indent=1)
    print("wrote out/routes/summary.json")
