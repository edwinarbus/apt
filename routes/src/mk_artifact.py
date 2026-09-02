"""Build the route-guide artifact HTML with embedded previews."""
import base64, html, json, os, re, sys
sys.path.insert(0, "src")
from chosen_routes import CHOSEN

OUT = "/tmp/claude-0/-home-user-apt/7e8492f6-f7e1-5666-87c5-11105ed98b6c/scratchpad/logo-runs.html"
routes = {r["slug"]: r for r in json.load(open("out/routes/summary.json"))}
verified = json.load(open("data/bakery_verified.json"))

PICK = {"anthropic-richmond-long"}
SHORT_PICK = {"anthropic-mission"}
NEAR_ANCHOR = {"anthropic-panhandle", "anthropic-lower-haight-long"}

STEEP = {
 "anthropic-mission": "3% on Juri St (mile 1.2)",
 "anthropic-outer-sunset": "10% on 34th Ave at Moraga (mile 3.5)",
 "anthropic-panhandle": "10% on Divisadero (mile 4.6)",
 "anthropic-richmond-long": "5% on 16th Ave (mile 0.8)",
 "anthropic-potrero-long": "5% on Vermont St (mile 5.1)",
 "anthropic-lower-haight-long": "9% on Hermann at Laguna (mile 4.7)"}

BLURB = {
 "anthropic-mission":
   "The tightest small A. Every part of the mark survives the grid — the flat top, the "
   "triangular counter, the notched feet, and a slash that still leans rather than "
   "standing up as a third leg. Shortest and flattest of the six, on the best bakery "
   "block in the city: La Victoria, Dianda's and Arizmendi are all within 150 feet.",
 "anthropic-outer-sunset":
   "The Sunset avenues are the most regular grid in San Francisco, so this A comes out "
   "crisp and near-symmetrical — the cleanest of the three short ones. The cost is "
   "bakeries: the Outer Sunset destinations are further west, so this gets solid "
   "neighbourhood shops instead.",
 "anthropic-panhandle":
   "Starts one block from your door, at Waller and Divisadero. The A leans about 12° "
   "because the NoPa grid does, and the left leg softens where it crosses the Panhandle, "
   "but the slash running down Divisadero is the sharpest single stroke in the set.",
 "anthropic-richmond-long":
   "The best A of the whole project. At 0.95 miles across, the counter, the notched feet "
   "and the slash all have room to be themselves, and the Richmond grid is even enough "
   "that almost nothing staircases. Thirteen bakeries on the line — Arsicault, "
   "Schubert's, Cinderella — and no pitch steeper than 5%.",
 "anthropic-potrero-long":
   "The flattest of the long three at 226 feet, and the richest for stops: fourteen "
   "bakeries, starting at Harrison and 24th. The A is clean through the Mission grid; "
   "the one soft spot is the slash's outer edge where it threads past the freeway "
   "around Vermont Street.",
 "anthropic-lower-haight-long":
   "Nearly a mile wide and still starts a quarter mile from home, at Duboce and Noe. It "
   "picks up Thorough Bread and the Church Street shops. The trade is climbing: 466 feet, "
   "including a 9% block of Hermann near Laguna that is the one real wall in the set.",
}

def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()

def cues_html(slug):
    md = open(f"out/routes/{slug}-cues.md").read()
    rows = re.findall(r"^\| (\d+) \| (.+?) \| (.+?) \|$", md, re.M)
    out = []
    for n, cue, dist in rows:
        cue = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html.escape(cue).replace("&lt;", "<").replace("&gt;", ">"))
        cue = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", cue)
        out.append(f'<li><span class="n">{n}</span><span class="c">{cue}</span>'
                   f'<span class="d">{html.escape(dist)}</span></li>')
    return "\n".join(out)

def bakery_rows(r):
    seen, out = set(), []
    for b in r["bakeries"]:
        nm = b["name"]
        if nm in seen: continue
        seen.add(nm)
        v = verified.get(nm)
        addr = f"{b['hn']} {b['street']}".strip() or (v or {}).get("addr", "")
        if v:
            hours = f"Sat {v['sat']} · Sun {v['sun']}"
            note = v.get("note", "")
            flag = ' <span class="flag">verify</span>' if v.get("uncertain") else ""
            src = v.get("src", "")
            nm_h = f'<a href="{html.escape(src)}" target="_blank" rel="noopener">{html.escape(nm)}</a>' if src else html.escape(nm)
        else:
            oh = b.get("hours", "").strip()
            hours = html.escape(oh) if oh else '<span class="dim">hours not confirmed</span>'
            note = ""; flag = ""; nm_h = html.escape(nm)
        out.append(
            f'<tr><td class="mi">{b["at_mi"]:.1f}</td>'
            f'<td><span class="bk">{nm_h}</span>{flag}'
            f'{f"<span class=bnote>{html.escape(note)}</span>" if note else ""}</td>'
            f'<td class="hrs">{hours}</td>'
            f'<td class="off">{b["dist_ft"]:.0f} ft</td></tr>')
        if len(out) >= 5: break
    return "\n".join(out)

RUNDATA = {}
cards = {"short": [], "long": []}
gallery = {"short": [], "long": []}
for tag, idx, slug, name, area, logo, tier in CHOSEN:
    r = routes[slug]
    img = f"data:image/jpeg;base64,{b64(f'out/web/{slug}.jpg')}"
    badge = ('<span class="badge pick">My pick</span>' if slug in PICK else
             ('<span class="badge pick2">Best short</span>' if slug in SHORT_PICK else ""))
    home = '<span class="badge home">Starts in the Lower Haight</span>' if slug in NEAR_ANCHOR else ""
    gallery[tier].append(f'''<figure class="g-item{' is-pick' if slug in PICK else ''}">
  <a href="#{slug}"><img src="{img}" alt="{html.escape(name)} route map" loading="lazy"></a>
  <figcaption><span class="g-name">{html.escape(name.split('—')[1].strip())}</span>
  <span class="g-meta">{r['dist_mi']:.2f} mi · {r['gain_ft']:.0f} ft</span></figcaption>
</figure>''')

    ray = ""

    RUNDATA[slug] = dict(
        name=name, dist=round(r["dist_mi"], 2), start=r["start"],
        cues=[dict(n=c["n"], w=c["word"], s=c["street"],
                   d=(f'{c["ft"]:.0f} ft' if c["ft"] < 950 else f'{c["mi"]:.2f} mi'),
                   c=round(c["cum_mi"], 2)) for c in r["cues"]],
        bakeries=[dict(n=b["name"], m=round(b["at_mi"], 1),
                       h=(verified.get(b["name"], {}) or {}).get("sat", ""))
                  for b in r["bakeries"][:5]])
    cards[tier].append(f'''<article class="card" id="{slug}">
  <div class="card-map"><img src="{img}" alt="{html.escape(name)} route map"></div>
  <div class="card-body">
    <header class="card-head">
      <div class="badges">{badge}{home}</div>
      <h3>{html.escape(name)}</h3>
      <p class="where">{html.escape(area)}</p>
    </header>
    <dl class="stats">
      <div><dt>Distance</dt><dd>{r['dist_mi']:.2f} mi</dd></div>
      <div><dt>Climb</dt><dd>{r['gain_ft']:.0f} ft</dd></div>
      <div><dt>Steepest</dt><dd>{r['grade']['max_up']:.1f}%</dd></div>
      <div><dt>Drawing</dt><dd>{r['width_mi']:.2f} mi across</dd></div>
    </dl>
    <p class="blurb">{BLURB[slug]}</p>
    {ray}
    <p class="start"><b>Start / finish</b> {html.escape(r['start'])}
      <span class="coord">{r['start_ll'][0]:.5f}, {r['start_ll'][1]:.5f}</span><br>
      <b>Steepest pitch</b> {STEEP[slug]}</p>
    <h4>Bakeries on the line</h4>
    <div class="tw"><table class="bakeries">
      <thead><tr><th>Mile</th><th>Bakery</th><th>Weekend hours</th><th>Off line</th></tr></thead>
      <tbody>{bakery_rows(r)}</tbody>
    </table></div>
    <details class="cues">
      <summary>Turn by turn — {len(r['cues'])} cues</summary>
      <ol class="cuelist">{cues_html(slug)}</ol>
    </details>
    <p class="file"><code>{slug}.gpx</code>
      <button class="runbtn" data-route="{slug}">Run mode</button></p>
  </div>
</article>''')

HTML = f'''<title>Logo Runs SF</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root {{
  --paper:#F6F7F9; --surface:#FFFFFF; --ink:#14161B; --ink-2:#3C424E;
  --muted:#666E7E; --rule:#E1E4EA; --rule-2:#EFF1F5;
  --accent:#FC5200; --accent-ink:#C23D00; --accent-wash:#FFF1EA;
  --warn:#9A5B00; --warn-wash:#FFF6E6;
  --shadow:0 1px 2px rgba(20,22,27,.06), 0 8px 24px -12px rgba(20,22,27,.18);
  --max:1180px;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --paper:#0C0E12; --surface:#161920; --ink:#EDEFF3; --ink-2:#C2C8D2;
    --muted:#8C95A5; --rule:#272C36; --rule-2:#1E222A;
    --accent:#FF6A28; --accent-ink:#FF8A52; --accent-wash:#2A160C;
    --warn:#E0A24A; --warn-wash:#2A2113;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 28px -14px rgba(0,0,0,.7);
  }}
}}
:root[data-theme="dark"] {{
  --paper:#0C0E12; --surface:#161920; --ink:#EDEFF3; --ink-2:#C2C8D2;
  --muted:#8C95A5; --rule:#272C36; --rule-2:#1E222A;
  --accent:#FF6A28; --accent-ink:#FF8A52; --accent-wash:#2A160C;
  --warn:#E0A24A; --warn-wash:#2A2113;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 28px -14px rgba(0,0,0,.7);
}}
* {{ box-sizing:border-box; }}
body {{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"Source Sans 3", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:17px; line-height:1.6; -webkit-font-smoothing:antialiased;
}}
.wrap {{ max-width:var(--max); margin:0 auto; padding:0 22px; }}
h1,h2,h3,h4 {{ font-family:Archivo, ui-sans-serif, system-ui, sans-serif; margin:0;
  letter-spacing:-.02em; text-wrap:balance; }}
a {{ color:var(--accent-ink); }}
a:focus-visible, summary:focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; border-radius:2px; }}

header.top {{ border-bottom:1px solid var(--rule); background:var(--surface); }}
header.top .wrap {{ padding-top:44px; padding-bottom:36px; }}
.eyebrow {{ font-family:"JetBrains Mono", ui-monospace, monospace; font-size:11.5px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--accent-ink); margin:0 0 14px; }}
h1 {{ font-size:clamp(34px,5.2vw,52px); font-weight:700; line-height:1.04; max-width:16ch; }}
.lede {{ margin:16px 0 0; max-width:62ch; font-size:19px; color:var(--ink-2); }}
.facts {{ display:flex; flex-wrap:wrap; gap:8px 26px; margin:24px 0 0; padding:0; list-style:none;
  font-family:"JetBrains Mono", ui-monospace, monospace; font-size:12.5px; color:var(--muted); }}
.facts b {{ color:var(--ink); font-weight:500; }}

section {{ padding:52px 0; }}
section + section {{ border-top:1px solid var(--rule); }}
h2 {{ font-size:clamp(22px,2.6vw,29px); font-weight:600; }}
.sub {{ color:var(--muted); margin:8px 0 0; max-width:64ch; }}
.tierhead {{ display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-top:44px; }}
.tierhead:first-of-type {{ margin-top:28px; }}
.tierhead h3 {{ font-size:20px; font-weight:600; }}
.tierhead span {{ font-family:"JetBrains Mono", monospace; font-size:12px; color:var(--muted); }}

.gallery {{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:16px; }}
@media (max-width:860px) {{ .gallery {{ grid-template-columns:repeat(2,1fr); }} }}
@media (max-width:520px) {{ .gallery {{ grid-template-columns:1fr; }} }}
.g-item {{ margin:0; background:var(--surface); border:1px solid var(--rule);
  border-radius:5px; overflow:hidden; box-shadow:var(--shadow); }}
.g-item.is-pick {{ border-color:var(--accent); }}
.g-item img {{ display:block; width:100%; height:auto; }}
.g-item figcaption {{ display:flex; justify-content:space-between; align-items:baseline;
  gap:10px; padding:11px 13px; border-top:1px solid var(--rule-2); }}
.g-name {{ font-family:Archivo, sans-serif; font-weight:600; font-size:14.5px; }}
.g-meta {{ font-family:"JetBrains Mono", monospace; font-size:11.5px; color:var(--muted);
  font-variant-numeric:tabular-nums; white-space:nowrap; }}

.verdict {{ display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:26px; }}
@media (max-width:760px) {{ .verdict {{ grid-template-columns:1fr; }} }}
.v-card {{ background:var(--surface); border:1px solid var(--rule); border-left:3px solid var(--accent);
  border-radius:4px; padding:20px 22px; }}
.v-card h3 {{ font-size:18px; font-weight:600; }}
.v-card .pickname {{ color:var(--accent-ink); }}
.v-card p {{ margin:9px 0 0; color:var(--ink-2); font-size:16px; }}
.v-card p.alt {{ font-size:14.5px; color:var(--muted); border-top:1px solid var(--rule-2);
  padding-top:9px; margin-top:12px; }}

.card {{ display:grid; grid-template-columns:minmax(0,420px) minmax(0,1fr); gap:0;
  background:var(--surface); border:1px solid var(--rule); border-radius:6px;
  overflow:hidden; box-shadow:var(--shadow); margin-top:26px; scroll-margin-top:20px; }}
@media (max-width:840px) {{ .card {{ grid-template-columns:1fr; }} }}
.card-map {{ border-right:1px solid var(--rule); background:var(--paper); }}
@media (max-width:840px) {{ .card-map {{ border-right:0; border-bottom:1px solid var(--rule); }} }}
.card-map img {{ display:block; width:100%; height:auto; }}
.card-body {{ padding:24px 26px 26px; min-width:0; }}
.badges {{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }}
.badge {{ font-family:"JetBrains Mono", monospace; font-size:10.5px; letter-spacing:.09em;
  text-transform:uppercase; padding:3px 8px; border-radius:3px; }}
.badge.pick {{ background:var(--accent); color:#fff; }}
.badge.pick2 {{ background:var(--ink); color:var(--paper); }}
.badge.home {{ background:var(--accent-wash); color:var(--accent-ink);
  border:1px solid color-mix(in srgb, var(--accent) 30%, transparent); }}
.card-head h3 {{ font-size:23px; font-weight:700; }}
.where {{ margin:4px 0 0; color:var(--muted); font-size:14.5px; }}
.stats {{ display:grid; grid-template-columns:repeat(4,auto); gap:0 26px; margin:20px 0 0;
  padding:14px 0; border-top:1px solid var(--rule-2); border-bottom:1px solid var(--rule-2);
  justify-content:start; }}
.stats div {{ min-width:0; }}
.stats dt {{ font-family:"JetBrains Mono", monospace; font-size:10.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--muted); }}
.stats dd {{ margin:3px 0 0; font-family:Archivo, sans-serif; font-weight:600; font-size:19px;
  font-variant-numeric:tabular-nums; white-space:nowrap; }}
@media (max-width:520px) {{ .stats {{ grid-template-columns:repeat(2,1fr); gap:14px 20px; }} }}
.blurb {{ margin:18px 0 0; color:var(--ink-2); }}
.ray {{ margin:14px 0 0; padding:11px 14px; background:var(--accent-wash); border-radius:4px;
  font-size:14.5px; color:var(--ink-2); }}
.ray b {{ color:var(--ink); }}
.start {{ margin:16px 0 0; font-size:14.5px; color:var(--ink-2); }}
.start b {{ color:var(--ink); font-weight:600; }}
.coord {{ font-family:"JetBrains Mono", monospace; font-size:12px; color:var(--muted); margin-left:6px; }}
h4 {{ font-size:12px; font-family:"JetBrains Mono", monospace; letter-spacing:.11em;
  text-transform:uppercase; color:var(--muted); font-weight:400; margin:24px 0 10px; }}
.tw {{ overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; font-size:14.5px; }}
th {{ text-align:left; font-family:"JetBrains Mono", monospace; font-size:10.5px;
  letter-spacing:.09em; text-transform:uppercase; color:var(--muted); font-weight:400;
  padding:0 12px 7px 0; border-bottom:1px solid var(--rule); white-space:nowrap; }}
td {{ padding:9px 12px 9px 0; border-bottom:1px solid var(--rule-2); vertical-align:top; }}
.mi, .off {{ font-family:"JetBrains Mono", monospace; font-size:12.5px;
  font-variant-numeric:tabular-nums; color:var(--muted); white-space:nowrap; }}
.bk {{ font-weight:600; }}
.hrs {{ font-family:"JetBrains Mono", monospace; font-size:12px; color:var(--ink-2);
  font-variant-numeric:tabular-nums; }}
.bnote {{ display:block; font-size:13px; color:var(--muted); margin-top:2px; }}
.dim {{ color:var(--muted); font-style:italic; }}
.flag {{ font-family:"JetBrains Mono", monospace; font-size:10px; letter-spacing:.08em;
  text-transform:uppercase; background:var(--warn-wash); color:var(--warn);
  padding:2px 6px; border-radius:3px; margin-left:6px; white-space:nowrap; }}
details.cues {{ margin-top:22px; border-top:1px solid var(--rule); padding-top:14px; }}
summary {{ cursor:pointer; font-family:Archivo, sans-serif; font-weight:600; font-size:15px; }}
summary::marker {{ color:var(--accent); }}
.cuelist {{ list-style:none; margin:14px 0 0; padding:0; }}
.cuelist li {{ display:grid; grid-template-columns:30px 1fr auto; gap:10px; align-items:baseline;
  padding:6px 0; border-bottom:1px solid var(--rule-2); font-size:15px; }}
.cuelist .n {{ font-family:"JetBrains Mono", monospace; font-size:11.5px; color:var(--muted);
  font-variant-numeric:tabular-nums; }}
.cuelist .d {{ font-family:"JetBrains Mono", monospace; font-size:12px; color:var(--muted);
  font-variant-numeric:tabular-nums; white-space:nowrap; }}
.file {{ margin:18px 0 0; }}
code {{ font-family:"JetBrains Mono", monospace; font-size:13px; background:var(--rule-2);
  padding:2px 7px; border-radius:3px; }}
ol.steps {{ padding-left:20px; max-width:66ch; }}
ol.steps li {{ margin:9px 0; }}
.notes {{ max-width:70ch; }}
.notes p {{ color:var(--ink-2); }}
.notes h3 {{ font-size:17px; font-weight:600; margin:26px 0 6px; }}
footer {{ border-top:1px solid var(--rule); padding:30px 0 56px; color:var(--muted); font-size:14px; }}

/* ---- run mode: one cue at a time, thumb-sized targets, works offline ---- */
.runbtn {{ font:600 13px/1 Archivo, sans-serif; color:#fff; background:var(--accent);
  border:0; border-radius:4px; padding:9px 15px; margin-left:10px; cursor:pointer; }}
.runbtn:hover {{ filter:brightness(1.08); }}
#run {{ position:fixed; inset:0; z-index:100; background:var(--surface); color:var(--ink);
  display:none; flex-direction:column; }}
#run.on {{ display:flex; }}
#run .rtop {{ display:flex; align-items:center; gap:12px; padding:14px 18px;
  border-bottom:1px solid var(--rule); flex:0 0 auto; }}
#run .rtop b {{ font-family:Archivo, sans-serif; font-size:16px; flex:1; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
#run .x {{ background:none; border:1px solid var(--rule); color:var(--ink); border-radius:4px;
  font:500 13px/1 "JetBrains Mono", monospace; padding:8px 12px; cursor:pointer; }}
#run .bar {{ height:4px; background:var(--rule-2); flex:0 0 auto; }}
#run .bar i {{ display:block; height:100%; background:var(--accent); width:0; transition:width .2s; }}
#run .body {{ flex:1; display:flex; flex-direction:column; justify-content:center;
  padding:22px 24px; gap:6px; min-height:0; }}
#run .idx {{ font:500 13px/1 "JetBrains Mono", monospace; color:var(--muted);
  letter-spacing:.1em; text-transform:uppercase; }}
#run .word {{ font:600 clamp(20px,5.5vw,28px)/1.15 Archivo, sans-serif; color:var(--accent-ink); }}
#run .street {{ font:700 clamp(30px,10vw,60px)/1.05 Archivo, sans-serif;
  letter-spacing:-.025em; text-wrap:balance; }}
#run .for {{ font:500 clamp(17px,4.6vw,22px)/1.2 "JetBrains Mono", monospace;
  color:var(--ink-2); margin-top:10px; font-variant-numeric:tabular-nums; }}
#run .then {{ margin-top:20px; padding-top:14px; border-top:1px solid var(--rule-2);
  color:var(--muted); font-size:15px; }}
#run .then b {{ color:var(--ink-2); font-weight:600; }}
#run .stop {{ margin-top:14px; padding:11px 14px; border-radius:5px;
  background:var(--accent-wash); color:var(--ink-2); font-size:15px; }}
#run .nav {{ display:flex; gap:1px; background:var(--rule); flex:0 0 auto; }}
#run .nav button {{ flex:1; border:0; background:var(--surface); color:var(--ink);
  font:600 17px/1 Archivo, sans-serif; padding:26px 0; cursor:pointer;
  -webkit-tap-highlight-color:transparent; }}
#run .nav button:active {{ background:var(--accent-wash); }}
#run .nav button.main {{ flex:2.4; background:var(--accent); color:#fff; }}
#run .nav button:disabled {{ color:var(--muted); opacity:.5; }}
@media (prefers-reduced-motion:reduce) {{ * {{ animation:none !important; transition:none !important; }} }}
</style>

<header class="top"><div class="wrap">
  <p class="eyebrow">Six routes · San Francisco · 4 to 7.5 miles</p>
  <h1>Running the A</h1>
  <p class="lede">Six routes whose Strava trace draws the Anthropic <b>A</b> — three short
  ones under 10K and three longer ones up to seven and a half miles. Traced from the official
  mark, snapped to real runnable streets, every one a loop that finishes where it starts.</p>
  <ul class="facts">
    <li><b>6</b> routes</li>
    <li><b>3.98–7.52</b> mi</li>
    <li><b>116–466</b> ft climbing</li>
    <li><b>2</b> start in the Lower Haight / Duboce Triangle</li>
    <li>Drawings <b>0.60–0.95</b> mi across</li>
  </ul>
</div></header>

<section><div class="wrap">
  <h2>All six</h2>
  <p class="sub">Orange line on a street map, framed the way Strava frames a route.
  Tap one to jump to its detail.</p>
  <div class="tierhead"><h3>Under 10K</h3><span>3.98 – 4.68 mi</span></div>
  <div class="gallery">{"".join(gallery["short"])}</div>
  <div class="tierhead"><h3>Longer</h3><span>6.85 – 7.52 mi</span></div>
  <div class="gallery">{"".join(gallery["long"])}</div>
</div></section>

<section><div class="wrap">
  <h2>What I'd pick</h2>
  <div class="verdict">
    <div class="v-card">
      <h3>Overall → <span class="pickname">Inner Richmond</span></h3>
      <p>7.52 miles, and the best A of the set. At 0.95 miles across, the counter, the
      notched feet and the slash all have room to be themselves, and the Richmond grid is
      even enough that almost nothing staircases. Thirteen bakeries on the line and nothing
      steeper than 5% — it is the cleanest drawing <i>and</i> the easiest long run here.</p>
    </div>
    <div class="v-card">
      <h3>If you want it short → <span class="pickname">the Mission</span></h3>
      <p>3.98 miles and 116 feet, the tightest small A and the flattest route of the six.
      La Victoria, Dianda's and Arizmendi all sit within 150 feet of the line, which makes
      it the best one to actually stop and eat on.</p>
      <p class="alt"><b>Starting from your door:</b> NoPa at 4.68 miles, from Waller and
      Divisadero — or Lower Haight at 6.85 if you want the distance.</p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Under 10K</h2>
  <p class="sub">Elevation is sampled from the USGS 10-metre model along each line.
  Bakery hours were checked against the shops' own sites and current listings.</p>
  {"".join(cards["short"])}
</div></section>

<section><div class="wrap">
  <h2>Longer</h2>
  <p class="sub">Around 0.95 miles across instead of 0.6 — the extra size is what lets the
  counter, the feet and the slash keep their shape instead of staircasing.</p>
  {"".join(cards["long"])}
</div></section>

<section><div class="wrap">
  <h2>Getting them onto Strava</h2>
  <ol class="steps">
    <li>On the Strava <b>website</b> (not the phone app), open
      <a href="https://www.strava.com/routes/new" target="_blank" rel="noopener">strava.com/routes/new</a>.</li>
    <li>Click the upload control and choose the <code>.gpx</code> file.</li>
    <li>Name it and save. It then syncs to the phone app under <b>My Routes</b>.</li>
  </ol>
  <p class="sub">Creating a route from a GPX file is a Strava subscriber feature. Without a
  subscription, upload at <a href="https://www.strava.com/upload/select" target="_blank" rel="noopener">strava.com/upload/select</a>
  instead — that posts it as an <i>activity</i> rather than a route, which still draws the
  map, but it appears in your feed as though you ran it. Only do that after the actual run.</p>
</div></section>

<section><div class="wrap notes">
  <h2>Honest notes</h2>
  <h3>Why these are all the A</h3>
  <p>The Claude burst is twelve tapered rays at irregular angles, and San Francisco has no
  radial street pattern to hang them on. Drawn small it collapses into an asterisk; drawn
  large enough to read properly it wants nine-plus miles. The A is all straight edges, so it
  maps onto a rectangular grid almost directly — which is why every one of these six works
  and the burst never quite did.</p>
  <h3>Size is what separates the two groups</h3>
  <p>The short three are about 0.6 miles across, the long three about 0.95. At the larger
  size each stroke spans more blocks, so the diagonals staircase less and the counter and
  feet stay sharp. If you only ever run one of these, run a long one.</p>
  <h3>Two things to check before you go</h3>
  <p>The Mill on Divisadero and Wholesome Bakery next door both show current hours on their
  own channels while Yelp flags the listings as closed. Both are on the NoPa route, which has
  four other confirmed options. Everything else here was checked against the shop's own site
  or a current listing.</p>
  <h3>Where the routes sit close together</h3>
  <p>Six mile-wide drawings do not fit into six unrelated neighbourhoods. The Mission pair
  covers different halves of the district — 24th Street for the short one, 20th to 24th and
  the Potrero flats for the long one — and the NoPa and Lower Haight routes are adjacent
  because that is where the flat ground near your door is. The other two, the Sunset and the
  Richmond, are on their own.</p>
  <h3>Hills</h3>
  <p>Nothing here is a Twin Peaks climb. The two walls are a 10% block of Divisadero at the
  end of the NoPa route and 9% on Hermann near Laguna on the Lower Haight one. The Mission,
  Potrero and Richmond routes are all gentle — none of them has a pitch over 6%.</p>
  <h3>If you change your mind about the burst</h3>
  <p>The working version is still in the repo. Drawn as the mark's true outline at 0.78 miles
  across it does read correctly, but it costs 9.1 miles to run.</p>
</div></section>

<div id="run" role="dialog" aria-modal="true" aria-label="Run mode">
  <div class="rtop"><b id="r-name"></b>
    <span id="r-wake" class="coord"></span>
    <button class="x" id="r-close">Close</button></div>
  <div class="bar"><i id="r-bar"></i></div>
  <div class="body">
    <div class="idx" id="r-idx"></div>
    <div class="word" id="r-word"></div>
    <div class="street" id="r-street"></div>
    <div class="for" id="r-for"></div>
    <div class="stop" id="r-stop" hidden></div>
    <div class="then" id="r-then"></div>
  </div>
  <div class="nav">
    <button id="r-prev">Back</button>
    <button id="r-next" class="main">Next turn</button>
  </div>
</div>

<footer><div class="wrap">
  Basemaps © OpenStreetMap contributors. Elevation from the USGS 3DEP 10-metre model.
  Logo geometry traced from the official Anthropic mark.
</div></footer>

<script>
const ROUTES = {json.dumps(RUNDATA)};
(function () {{
  const $ = id => document.getElementById(id);
  const pane = $("run");
  let slug = null, i = 0, lock = null;

  const key = s => "logorun:" + s;
  const save = () => {{ try {{ localStorage.setItem(key(slug), String(i)); }} catch (e) {{}} }};
  const load = s => {{ try {{ return parseInt(localStorage.getItem(key(s)) || "0", 10) || 0; }}
                      catch (e) {{ return 0; }} }};

  async function wake(on) {{
    try {{
      if (on && "wakeLock" in navigator) {{
        lock = await navigator.wakeLock.request("screen");
        $("r-wake").textContent = "screen stays on";
      }} else if (lock) {{ await lock.release(); lock = null; $("r-wake").textContent = ""; }}
    }} catch (e) {{ $("r-wake").textContent = ""; }}
  }}

  function draw() {{
    const r = ROUTES[slug], c = r.cues[i], nx = r.cues[i + 1];
    $("r-name").textContent = r.name;
    $("r-idx").textContent = `Turn ${{c.n}} of ${{r.cues.length}} · mile ${{c.c.toFixed(2)}} of ${{r.dist}}`;
    $("r-word").textContent = c.w;
    $("r-street").textContent = c.s;
    $("r-for").textContent = "for " + c.d;
    $("r-then").innerHTML = nx ? `Then <b>${{nx.w.toLowerCase()}} ${{nx.s}}</b>`
                               : "Then you are back at the start — done.";
    $("r-bar").style.width = (100 * (i + 1) / r.cues.length).toFixed(1) + "%";
    const near = r.bakeries.filter(b => Math.abs(b.m - c.c) < 0.16);
    if (near.length) {{
      $("r-stop").hidden = false;
      $("r-stop").innerHTML = near.map(b =>
        `<b>${{b.n}}</b> is here${{b.h ? " · Sat " + b.h : ""}}`).join("<br>");
    }} else $("r-stop").hidden = true;
    $("r-prev").disabled = i === 0;
    $("r-next").textContent = i >= r.cues.length - 1 ? "Finish" : "Next turn";
  }}

  function open(s) {{
    slug = s; i = Math.min(load(s), ROUTES[s].cues.length - 1);
    pane.classList.add("on"); document.body.style.overflow = "hidden";
    draw(); wake(true);
    if (i > 0) $("r-idx").textContent += " · resumed";
  }}
  function close() {{
    pane.classList.remove("on"); document.body.style.overflow = "";
    wake(false); slug = null;
  }}

  document.querySelectorAll(".runbtn").forEach(b =>
    b.addEventListener("click", () => open(b.dataset.route)));
  $("r-close").addEventListener("click", close);
  $("r-next").addEventListener("click", () => {{
    if (i >= ROUTES[slug].cues.length - 1) {{ try {{ localStorage.removeItem(key(slug)); }} catch (e) {{}} close(); return; }}
    i++; save(); draw();
  }});
  $("r-prev").addEventListener("click", () => {{ if (i > 0) {{ i--; save(); draw(); }} }});
  document.addEventListener("keydown", e => {{
    if (!slug) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight" || e.key === " ") {{ e.preventDefault(); $("r-next").click(); }}
    if (e.key === "ArrowLeft") $("r-prev").click();
  }});
  document.addEventListener("visibilitychange", () => {{
    if (document.visibilityState === "visible" && slug) wake(true);
  }});
}})();
</script>
'''
open(OUT, "w").write(HTML)
print("wrote", OUT, f"{os.path.getsize(OUT)/1024/1024:.2f} MB")
