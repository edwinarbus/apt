import { webkit } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const OUT = process.env.OUT_DIR ?? ".";

const INSTRUMENT = `
window.__fps = { on: false, frames: [] };
(function loop(t){ if (window.__fps.on) window.__fps.frames.push(t); requestAnimationFrame(loop); })();
window.__fpsStart = () => { window.__fps.frames = []; window.__fps.on = true; };
window.__fpsStop = () => {
  window.__fps.on = false;
  const f = window.__fps.frames;
  const d = [];
  for (let i = 1; i < f.length; i++) d.push(f[i] - f[i-1]);
  d.sort((a,b)=>a-b);
  const span = f.length ? f[f.length-1]-f[0] : 0;
  const fps = span ? Math.round((f.length-1)/span*1000) : 0;
  const p = (q)=> d.length ? +d[Math.min(d.length-1, Math.floor(d.length*q))].toFixed(1) : 0;
  return {
    fps,
    frames: d.length,
    p50: p(0.5), p95: p(0.95),
    longest: d.length ? +d[d.length-1].toFixed(1) : 0,
    dropped: d.filter(x=>x>32).length,     // > ~2 frames @60 = visible hitch
    janky: d.filter(x=>x>50).length,
  };
};
`;

async function scenario(page, name, fn, ms = 3500) {
  await page.evaluate(() => window.__fpsStart());
  await fn();
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => window.__fpsStop());
  return { name, ...r };
}

async function findMarinaPixel(page) {
  return page.evaluate(() => {
    const m = window.__aptMap;
    const cs = [[-122.4486,37.8022],[-122.4436,37.8037],[-122.4462,37.8060],[-122.4413,37.8052]];
    const r = m.getCanvas().getBoundingClientRect();
    for (const c of cs) {
      const p = m.project(c);
      if (p.x<10||p.y<10||p.x>r.width-10||p.y>r.height-10) continue;
      if (m.queryRenderedFeatures([p.x,p.y],{layers:["points","clusters"]}).length) continue;
      const h = m.queryRenderedFeatures([p.x,p.y],{layers:["hoods-fill"]});
      if (h.length && h[0].properties.name==="Marina") return { x: r.left+p.x, y: r.top+p.y };
    }
    return null;
  });
}

async function run(device) {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: device.viewport,
    ...(device.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    geolocation: { latitude: 37.7793, longitude: -122.4193 },
    permissions: ["geolocation"],
  });
  const page = await ctx.newPage();
  await page.addInitScript(INSTRUMENT);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(9000);

  const results = [];
  results.push(await scenario(page, "idle", async () => {}, 2500));

  // Pan/drag
  results.push(await scenario(page, "pan", async () => {
    const b = page.viewportSize();
    await page.mouse.move(b.width*0.4, b.height*0.6);
    await page.mouse.down();
    for (let i=0;i<12;i++){ await page.mouse.move(b.width*0.4 - i*14, b.height*0.6 - i*8); await page.waitForTimeout(16); }
    await page.mouse.up();
  }, 2500));

  // Hood lift
  const pt = await findMarinaPixel(page);
  if (pt) {
    results.push(await scenario(page, "hood-lift", async () => { await page.mouse.click(pt.x, pt.y); }, 5000));
    // release
    const chip = page.locator("text=▣ Marina");
    if (await chip.isVisible().catch(()=>false)) { await chip.click(); await page.waitForTimeout(2500); }
  } else {
    results.push({ name: "hood-lift", skipped: "no marina pixel" });
  }

  // Search sonar
  results.push(await scenario(page, "search-sonar", async () => {
    await page.locator("textarea").fill("hardwood floors and natural light");
    await page.locator("button", { hasText: "Search" }).click();
  }, 5000));

  await browser.close();
  return { device: device.name, results };
}

const desktop = { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false };
const mobile = { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true };

const out = [];
for (const d of [desktop, mobile]) out.push(await run(d));
console.log(JSON.stringify(out, null, 2));
import fs from "node:fs";
fs.writeFileSync(`${OUT}/fps.json`, JSON.stringify(out, null, 2));
