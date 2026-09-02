"""Emit a phone-readable cue sheet per route."""
import json, os, sys
sys.path.insert(0, "src")

BAKERY_NOTES = json.load(open("data/bakery_notes.json")) if os.path.exists("data/bakery_notes.json") else {}


def fmt_dist(mi):
    ft = mi * 5280
    return f"{ft:.0f} ft" if ft < 950 else f"{mi:.2f} mi"


def write(route):
    L = []
    a = L.append
    a(f"# {route['name']}")
    a("")
    a(f"**{route['area']}** · **{route['dist_mi']:.2f} mi** · "
      f"**+{route['gain_ft']:.0f} ft** climbing · "
      f"low {route['lo_ft']:.0f} ft / high {route['hi_ft']:.0f} ft · "
      f"steepest ~{route['grade']['max_up']:.1f}% grade")
    a("")
    a(f"Drawing is about {route['width_mi']:.2f} mi across. "
      f"Start/finish: **{route['start']}** ({route['start_ll'][0]:.5f}, {route['start_ll'][1]:.5f}). "
      f"It is a loop, so you finish where you start.")
    a("")
    a("## Bakeries on the line")
    a("")
    a("| Mile | Bakery | Off the line | Address |")
    a("|---:|---|---:|---|")
    for b in route["bakeries"][:6]:
        addr = f"{b['hn']} {b['street']}".strip() or "—"
        a(f"| {b['at_mi']:.1f} | {b['name']} | {b['dist_ft']:.0f} ft | {addr} |")
    a("")
    a("## Turn by turn")
    a("")
    a("| # | Cue | For |")
    a("|---:|---|---|")
    for c in route["cues"]:
        a(f"| {c['n']} | {c['word']} **{c['street']}** | {fmt_dist(c['mi'])} |")
    a("")
    a("_Retraced blocks are normal — Strava draws the line on top of itself._")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    rows = json.load(open("out/routes/summary.json"))
    os.makedirs("out/routes", exist_ok=True)
    for r in rows:
        p = f"out/routes/{r['slug']}-cues.md"
        open(p, "w").write(write(r))
        print("wrote", p, f"({len(r['cues'])} cues)")
