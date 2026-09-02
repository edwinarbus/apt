"""Preview renderers: a diagnostic view for iteration, and a Strava-style
orange-line-on-street-map view for the final deliverable."""
import math, os, io, time, urllib.request
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from graph import ll_to_xy, xy_to_ll

STRAVA_ORANGE = "#FC5200"
CACHE = "data/tiles"


# ------------------------------------------------------------ slippy tiles
def deg2num(lat, lon, z):
    la = math.radians(lat); n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(la)) / math.pi) / 2.0 * n)

def num2deg(x, y, z):
    n = 2.0 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon

TILE_SRC = [
    ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", "osm"),
    ("https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", "hot"),
]

def fetch_tile(z, x, y, src=0):
    os.makedirs(CACHE, exist_ok=True)
    tmpl, nm = TILE_SRC[src]
    fn = f"{CACHE}/{nm}_{z}_{x}_{y}.png"
    if os.path.exists(fn) and os.path.getsize(fn) > 400:
        try: return Image.open(fn).convert("RGB")
        except Exception: pass
    url = tmpl.format(z=z, x=x, y=y)
    for a in range(4):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "sf-gpsart/1.0 (personal running route previews)"})
            with urllib.request.urlopen(req, timeout=45) as r:
                b = r.read()
            if len(b) < 200: raise IOError("tiny tile")
            open(fn, "wb").write(b)
            return Image.open(io.BytesIO(b)).convert("RGB")
        except Exception:
            time.sleep(1.2 + a)
    return Image.new("RGB", (256, 256), (238, 236, 231))


def basemap(bbox_ll, px=1100, pad=0.07):
    """Stitched OSM basemap covering bbox with padding. Returns (img, extent, z)."""
    s, w, n, e = bbox_ll
    dlat, dlon = (n - s) * pad, (e - w) * pad
    s, w, n, e = s - dlat, w - dlon, n + dlat, e + dlon
    for z in range(19, 10, -1):
        x0, y0 = deg2num(n, w, z); x1, y1 = deg2num(s, e, z)
        if (x1 - x0) * 256 <= px * 1.9 and (y1 - y0) * 256 <= px * 1.9:
            break
    tx0, ty0 = int(math.floor(x0)), int(math.floor(y0))
    tx1, ty1 = int(math.ceil(x1)), int(math.ceil(y1))
    W, H = (tx1 - tx0) * 256, (ty1 - ty0) * 256
    img = Image.new("RGB", (W, H), (238, 236, 231))
    for tx in range(tx0, tx1):
        for ty in range(ty0, ty1):
            img.paste(fetch_tile(z, tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
    latN, lonW = num2deg(tx0, ty0, z)
    latS, lonE = num2deg(tx1, ty1, z)
    return img, (lonW, lonE, latS, latN), z, (s, w, n, e)


def _inv_merc(y):
    return math.degrees(math.atan(math.sinh(math.radians(y))))


def mercator_y(lat):
    return math.degrees(math.asinh(math.tan(math.radians(lat))))


def strava_preview(latlon, out, title="", bbox=None, px=1150, lw=6.4,
                   markers=None, dim=0.62, pad=0.07, square=True):
    """Orange route line over a real street basemap, framed like Strava."""
    lat, lon = latlon[:, 0], latlon[:, 1]
    if bbox is None:
        s0, w0, n0, e0 = lat.min(), lon.min(), lat.max(), lon.max()
        if square:   # Strava frames a route in a near-square card
            my0, my1 = mercator_y(s0), mercator_y(n0)
            h, wdt = my1 - my0, e0 - w0
            if wdt > h:
                c = 0.5 * (my0 + my1); my0, my1 = c - wdt / 2, c + wdt / 2
                s0 = _inv_merc(my0); n0 = _inv_merc(my1)
            else:
                c = 0.5 * (w0 + e0); w0, e0 = c - h / 2, c + h / 2
        bbox = (s0, w0, n0, e0)
    img, ext, z, want = basemap(bbox, px=px, pad=pad)
    lonW, lonE, latS, latN = ext
    W, H = img.size
    a = np.asarray(img).astype(float)
    a = 255 - (255 - a) * (1 - dim * 0.0)      # keep basemap; dim via alpha below
    ws, ww, wn, we = want
    aspect = (mercator_y(wn) - mercator_y(ws)) / (we - ww)
    fig_w = 9.0
    fig = plt.figure(figsize=(fig_w, fig_w * aspect), dpi=150)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_axis_off()
    ax.imshow(img, extent=[lonW, lonE, mercator_y(latS), mercator_y(latN)],
              aspect="auto", interpolation="lanczos")
    ax.add_patch(plt.Rectangle((lonW, mercator_y(latS)), lonE - lonW,
                 mercator_y(latN) - mercator_y(latS), color="white", alpha=dim, zorder=2))
    my = np.array([mercator_y(v) for v in lat])
    ax.plot(lon, my, color="white", lw=lw + 3.0, solid_capstyle="round",
            solid_joinstyle="round", zorder=3, alpha=0.85)
    ax.plot(lon, my, color=STRAVA_ORANGE, lw=lw, solid_capstyle="round",
            solid_joinstyle="round", zorder=4)
    ax.plot([lon[0]], [my[0]], "o", ms=lw + 5, mfc="#12b886", mec="white", mew=2, zorder=6)
    if markers:
        for (mlat, mlon, lbl) in markers:
            ax.plot([mlon], [mercator_y(mlat)], "o", ms=lw + 3, mfc="#ffffff",
                    mec="#333", mew=1.6, zorder=6)
    ws, ww, wn, we = want
    ax.set_xlim(ww, we); ax.set_ylim(mercator_y(ws), mercator_y(wn))
    if title:
        ax.text(0.5, 0.982, title, transform=ax.transAxes, ha="center", va="top",
                fontsize=13, weight="bold", color="#222",
                bbox=dict(boxstyle="round,pad=0.42", fc="white", ec="none", alpha=0.86), zorder=8)
    fig.savefig(out, dpi=150, facecolor="white")
    plt.close(fig)
    return out


def diag_preview(g, keep, latlon, ideal_polys, out, title="", pad_ft=1400):
    """Streets + ideal logo + snapped route, for checking the fit."""
    lat, lon = latlon[:, 0], latlon[:, 1]
    X, Y = ll_to_xy(lat, lon)
    x0, x1 = X.min() - pad_ft, X.max() + pad_ft
    y0, y1 = Y.min() - pad_ft, Y.max() + pad_ft
    fig, ax = plt.subplots(figsize=(9, 9 * (y1 - y0) / (x1 - x0)), dpi=130)
    sel = (g.X > x0) & (g.X < x1) & (g.Y > y0) & (g.Y < y1) & keep
    segs = []
    idx = np.flatnonzero(sel)
    ss = set(idx.tolist())
    for i in idx:
        for (j, ln, mult, wid) in g.nbrs[i]:
            if j in ss and j > i:
                segs.append([(g.X[i], g.Y[i]), (g.X[j], g.Y[j])])
    from matplotlib.collections import LineCollection
    ax.add_collection(LineCollection(segs, colors="#c9c9c9", linewidths=0.7, zorder=1))
    for p in ideal_polys:
        ax.plot(p[:, 0], p[:, 1], "--", color="#1f77b4", lw=1.8, alpha=0.85, zorder=2)
    ax.plot(X, Y, color=STRAVA_ORANGE, lw=3.6, solid_capstyle="round", zorder=3)
    ax.plot([X[0]], [Y[0]], "o", ms=9, mfc="#12b886", mec="white", mew=1.6, zorder=4)
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_aspect("equal"); ax.set_axis_off()
    ax.set_title(title, fontsize=11)
    fig.tight_layout(); fig.savefig(out, dpi=130, facecolor="white"); plt.close(fig)
    return out
