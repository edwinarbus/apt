"""Write GPX 1.1 route files that Strava accepts as a route upload."""
import datetime as dt
from xml.sax.saxutils import escape
import numpy as np


def write_gpx(path, latlon, elev_ft=None, name="Route", desc=""):
    """Strava's route importer reads <trk>; elevations are metres."""
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    L = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<gpx version="1.1" creator="sf-logo-routes" xmlns="http://www.topografix.com/GPX/1/1" '
         'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
         'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 '
         'http://www.topografix.com/GPX/1/1/gpx.xsd">',
         '  <metadata>', f'    <name>{escape(name)}</name>',
         f'    <desc>{escape(desc)}</desc>', f'    <time>{now}</time>', '  </metadata>',
         '  <trk>', f'    <name>{escape(name)}</name>', '    <trkseg>']
    for i, (la, lo) in enumerate(latlon):
        if elev_ft is not None:
            L.append(f'      <trkpt lat="{la:.7f}" lon="{lo:.7f}">'
                     f'<ele>{elev_ft[i]/3.280839895:.1f}</ele></trkpt>')
        else:
            L.append(f'      <trkpt lat="{la:.7f}" lon="{lo:.7f}"></trkpt>')
    L += ['    </trkseg>', '  </trk>', '</gpx>', '']
    open(path, "w").write("\n".join(L))
    return path


def dedupe(latlon, min_ft=3.0):
    """Drop near-duplicate consecutive points (keeps files small and clean)."""
    from graph import ll_to_xy
    x, y = ll_to_xy(latlon[:, 0], latlon[:, 1])
    keep = [0]
    for i in range(1, len(latlon)):
        if np.hypot(x[i] - x[keep[-1]], y[i] - y[keep[-1]]) >= min_ft:
            keep.append(i)
    if keep[-1] != len(latlon) - 1:
        keep.append(len(latlon) - 1)
    return latlon[keep]
