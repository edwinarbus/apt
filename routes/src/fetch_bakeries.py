"""Bakery / pastry / dessert POIs across San Francisco, with any OSM hours."""
import json, sys, time, urllib.parse, urllib.request
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
S, W, N, E = 37.7020, -122.5180, 37.8150, -122.3500
Q = f"""
[out:json][timeout:180];
(
  nwr["shop"="bakery"]({S},{W},{N},{E});
  nwr["shop"="pastry"]({S},{W},{N},{E});
  nwr["cuisine"~"bakery|pastry|donut|cake",i]({S},{W},{N},{E});
  nwr["amenity"="cafe"]["cuisine"~"coffee_shop",i]["bakery"]({S},{W},{N},{E});
);
out center tags;
"""
def main(out):
    data = urllib.parse.urlencode({"data": Q}).encode()
    for a in range(4):
        for m in MIRRORS:
            try:
                req = urllib.request.Request(m, data=data, headers={"User-Agent": "sf-gpsart/1.0"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    d = json.loads(r.read())
                rows = []
                for el in d["elements"]:
                    t = el.get("tags", {})
                    lat = el.get("lat") or (el.get("center") or {}).get("lat")
                    lon = el.get("lon") or (el.get("center") or {}).get("lon")
                    if lat is None or not t.get("name"): continue
                    rows.append(dict(name=t["name"], lat=lat, lon=lon,
                                     shop=t.get("shop", t.get("amenity", "")),
                                     cuisine=t.get("cuisine", ""),
                                     hours=t.get("opening_hours", ""),
                                     street=t.get("addr:street", ""),
                                     hn=t.get("addr:housenumber", ""),
                                     web=t.get("website", "")))
                json.dump(rows, open(out, "w"), indent=1)
                print(f"{len(rows)} bakery POIs -> {out}", file=sys.stderr)
                return
            except Exception as ex:
                print(f"  {m.split('/')[2]}: {type(ex).__name__}", file=sys.stderr)
                time.sleep(3 + 3*a)
    raise SystemExit("failed")
main(sys.argv[1])
