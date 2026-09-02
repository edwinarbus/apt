"""Precise elevation for a finished route, from the USGS 10 m DEM."""
import json, time, urllib.request, urllib.parse
import numpy as np

URL = "https://api.opentopodata.org/v1/ned10m"


def query(latlon, batch=100, pause=1.05):
    z = np.full(len(latlon), np.nan)
    for i in range(0, len(latlon), batch):
        ch = latlon[i:i+batch]
        body = urllib.parse.urlencode(
            {"locations": "|".join(f"{a:.6f},{b:.6f}" for a, b in ch)}).encode()
        for attempt in range(6):
            try:
                req = urllib.request.Request(URL, data=body,
                        headers={"User-Agent": "sf-gpsart/1.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    d = json.loads(r.read())
                if d.get("status") == "OK":
                    for k, res in enumerate(d["results"]):
                        e = res.get("elevation")
                        if e is not None: z[i+k] = e
                    break
                time.sleep(2 + 2*attempt)
            except Exception:
                time.sleep(2 + 2*attempt)
        time.sleep(pause)
    return z * 3.280839895   # -> feet


def profile(latlon, ele_ft, resample_ft=80.0, smooth_ft=400.0, xy=None):
    """Gain/loss the way a GPS watch reports it: resample the profile at a fixed
    spacing, smooth over a few hundred feet, then sum the rises.

    Summing raw sample-to-sample deltas on densely spaced points mostly adds up
    DEM noise; smoothing first is what keeps the number honest.
    """
    from graph import ll_to_xy
    e = np.asarray(ele_ft, float)
    ok = ~np.isnan(e)
    if ok.sum() < 2:
        return dict(gain=0.0, loss=0.0, lo=0.0, hi=0.0, ele=e)
    e = np.interp(np.arange(len(e)), np.flatnonzero(ok), e[ok])
    if xy is None:
        X, Y = ll_to_xy(np.asarray(latlon)[:, 0], np.asarray(latlon)[:, 1])
    else:
        X, Y = xy
    d = np.r_[0.0, np.cumsum(np.hypot(np.diff(X), np.diff(Y)))]
    if d[-1] <= 0:
        return dict(gain=0.0, loss=0.0, lo=float(e.min()), hi=float(e.max()), ele=e)
    grid = np.arange(0.0, d[-1], resample_ft)
    eg = np.interp(grid, d, e)
    w = max(3, int(round(smooth_ft / resample_ft)) | 1)
    if len(eg) > w:
        k = np.ones(w) / w
        pad = np.r_[np.full(w, eg[0]), eg, np.full(w, eg[-1])]
        eg = np.convolve(pad, k, mode="same")[w:-w]
    dz = np.diff(eg)
    return dict(gain=float(np.sum(np.clip(dz, 0, None))),
                loss=float(-np.sum(np.clip(dz, None, 0))),
                lo=float(e.min()), hi=float(e.max()), ele=e)


def grade_stats(x_ft, y_ft, ele_ft, win_ft=300.0):
    """Steepest sustained grade over ~300 ft windows, in percent."""
    d = np.r_[0.0, np.cumsum(np.hypot(np.diff(x_ft), np.diff(y_ft)))]
    g = []
    j = 0
    for i in range(len(d)):
        while j < len(d) - 1 and d[j] - d[i] < win_ft: j += 1
        if d[j] - d[i] >= win_ft * 0.8:
            g.append((ele_ft[j] - ele_ft[i]) / (d[j] - d[i]) * 100.0)
    g = np.array(g) if g else np.array([0.0])
    return dict(max_up=float(g.max()), max_down=float(g.min()),
                p95_up=float(np.percentile(np.abs(g), 95)))
