"""Render diagnostic previews for the top candidates of each search."""
import glob, os, pickle, sys
sys.path.insert(0, "src")
import numpy as np
from ctx import load
from render import diag_preview

c = load(); g, keep = c['g'], c['keep']
os.makedirs("out/diag", exist_ok=True)
for fn in sorted(glob.glob("out/cand/*.pkl")):
    tag = os.path.basename(fn)[:-4]
    try: res = pickle.load(open(fn, "rb"))
    except Exception as e: print("skip", fn, e); continue
    if not res: print("empty", fn); continue
    for i, r in enumerate(res[:3]):
        t = (f"{tag} #{i}  {r['dist']:.2f}mi  gain {r['gain']:.0f}ft  "
             f"match {r['match']['match']*100:.2f}%  w={r['width_ft']/5280:.2f}mi rot={r['rot']:+.0f}")
        diag_preview(g, keep, r['latlon'], [s['ideal'] for s in r['snapped']],
                     f"out/diag/{tag}_{i}.png", title=t)
        print("  ", t)
