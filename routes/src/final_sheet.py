"""Montage of Strava-style previews for the finalists."""
import sys, pickle, os
sys.path.insert(0, "src")
import numpy as np
from PIL import Image
from render import strava_preview
from gpx import dedupe

def build(sel, out, ncol=4, cell=760):
    paths = []
    for tag, idx, name in sel:
        res = pickle.load(open(f"out/cand/{tag}.pkl", "rb"))
        r = res[idx]
        p = f"out/fin_{tag}_{idx}.png"
        if not os.path.exists(p):
            strava_preview(dedupe(r["latlon"], 8.0), p, px=760, lw=5.6,
                           title=f"{name}  {r['dist']:.2f} mi  {r['gain']:.0f} ft")
        paths.append(p)
        print(f"  {name}: {r['dist']:.2f}mi {r['gain']:.0f}ft "
              f"IoU={r.get('iou',float('nan'))*100:.0f}%")
    imgs = [Image.open(p).convert("RGB") for p in paths]
    imgs = [im.resize((cell, int(cell * im.size[1] / im.size[0])), Image.LANCZOS) for im in imgs]
    nrow = (len(imgs) + ncol - 1) // ncol
    h = max(im.size[1] for im in imgs)
    sheet = Image.new("RGB", (ncol * cell, nrow * h), "white")
    for i, im in enumerate(imgs):
        sheet.paste(im, ((i % ncol) * cell, (i // ncol) * h))
    sheet.save(out)
    return out
