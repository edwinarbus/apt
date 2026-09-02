# Logo running routes, San Francisco

Six GPS-art running routes whose Strava trace draws the Anthropic **A** mark —
three short ones under the 10K mark and three longer ones up to seven and a half
miles. Every route is a **loop**: you finish where you start.

## Under 10K

| Route | Where | Distance | Climb | Steepest | Start |
|---|---|---:|---:|---:|---|
| Anthropic — Mission | Mission District (24th Street) | 3.98 mi | 116 ft | 4.4% | 24th Street & Mission Street |
| Anthropic — Outer Sunset | Outer Sunset | 4.55 mi | 338 ft | 9.2% | 30th Avenue & Kirkham Street |
| Anthropic — NoPa & the Panhandle | NoPa / Panhandle | 4.68 mi | 320 ft | 12.2% | **Waller Street & Divisadero Street** |

## Longer

| Route | Where | Distance | Climb | Steepest | Start |
|---|---|---:|---:|---:|---|
| Anthropic — Inner Richmond | Inner Richmond | 7.52 mi | 288 ft | 5.8% | Lake Street & 11th Avenue |
| Anthropic — Mission & Potrero Flats | Inner Mission / Potrero Flats | 7.00 mi | 226 ft | 6.2% | Harrison Street & 24th Street |
| Anthropic — Lower Haight | Lower Haight / Alamo Square | 6.85 mi | 466 ft | 13.6% | **Duboce Avenue & Noe Street** |

Routes in **bold** start in the Lower Haight / Duboce Triangle.

The short three are drawn about 0.60 mi across, the long three about 0.95 mi. At the
larger size each stroke spans more blocks, so the diagonals staircase less and the
counter, the notched feet and the slash all keep their shape.

## About the Claude burst

Earlier versions of this also drew the Claude mark. It is twelve tapered rays at
irregular angles and San Francisco has no radial street pattern to hang them on:
drawn small it collapses into an asterisk, and drawn large enough to read properly
it costs over nine miles. The machinery is still here — `claude_outline()`,
`claude_star()` and `ray_width_profile()` in `src/logo_strokes.py`, and
`src/sweep_outline.py` to search for placements — but no burst route ships.

## Files

```
out/routes/
  <slug>.gpx        upload this to Strava
  <slug>.jpg        preview: orange line on a street map
  <slug>-cues.md    turn-by-turn + bakeries, readable on a phone
  summary.json      all stats, cues and bakery matches as data
out/all_six.jpg     all six previews side by side
```

## Uploading to Strava

On the **website** (not the app):

1. Go to <https://www.strava.com/routes/new>
2. Click the upload control and pick the `.gpx` file
3. Name it and save

Creating a route from a GPX file is a Strava **subscriber** feature. If you are
not subscribed, upload the file at <https://www.strava.com/upload/select>
instead — it lands as an *activity* rather than a route, which still draws the
map, but it will show in your feed as if you ran it, so only do that after the
actual run.
## How these were made

`src/` holds the whole pipeline. To rebuild from scratch:

```bash
cd routes
pip install shapely numpy scipy matplotlib pillow svgpathtools networkx
python3 src/fetch_osm.py data/sf_osm.json        # ~40 MB of runnable SF ways
python3 src/graph.py data/sf_osm.json data/sf_graph.pkl
python3 src/fetch_dem.py data/sf_dem.npz         # USGS 10 m elevation grid
python3 src/fetch_bakeries.py data/bakeries.json
python3 src/make_all.py                          # snaps, measures, writes everything
python3 src/write_cues.py
```

Pipeline, in order:

1. **`logo_geom.py` / `logo_strokes.py`** — parse the official logo SVGs and turn
   the filled glyphs into drawable stroke geometry. Both marks keep their real
   outline: the A body with its counter and slash, and the burst's twelve tapered
   rays. `ray_width_profile()` measures the flank separation that decides how big
   the burst has to be drawn.
2. **`graph.py`** — a routable graph of SF's runnable ways, with per-surface cost.
3. **`place.py` / `citysearch.py`** — sweep centre × size × rotation, scoring how
   closely the ideal strokes lie on real streets, with penalties for hills and
   bonuses for bakeries on the line.
4. **`snap.py` / `build.py`** — corridor-restricted Dijkstra hugs each stroke;
   the assembler picks stroke order and loop entry points so the joins between
   strokes retrace ink already drawn.
5. **`vismatch.py`** — rasterises the run against the logo and scores the overlap.
6. **`finalize.py` / `render.py` / `cues.py`** — elevation, GPX, cue sheets, previews.
