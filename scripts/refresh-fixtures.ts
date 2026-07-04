import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { sources } from "@/db/schema";
import { PoliteFetcher } from "@/core/fetcher";
import { parseClSearchPage } from "@/adapters/craigslist";
import { parseRsnResultsPage } from "@/adapters/rentsfnow";
import type { BtApiResponse } from "@/adapters/rentbt";
import { isSfLocation } from "@/core/neighborhoods";

/**
 * Re-record adapter fixtures from the live sources (a handful of polite
 * requests). Run this when a parser test starts failing against reality:
 *
 *   npm run fixtures:refresh -- --source craigslist_sf
 *   npm run fixtures:refresh -- --source rentsfnow
 *
 * After refreshing, re-run `npm run test:adapters` — fixture-dependent
 * assertions (counts, specific values) may need updating.
 */

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

function save(name: string, content: string): void {
  fs.writeFileSync(path.join(FIXTURES_DIR, name), content);
  console.log(`  saved fixtures/${name} (${content.length} bytes)`);
}

async function refreshCraigslist(): Promise<void> {
  const db = await createDb();
  const source = await db.select().from(sources).where(eq(sources.id, "craigslist_sf")).get();
  if (!source?.listingUrl) throw new Error("craigslist_sf not seeded");
  const fetcher = new PoliteFetcher({
    requestDelayMs: source.requestDelayMs,
    timeoutMs: source.timeoutMs,
    retryCount: 1,
  });
  const search = await fetcher.fetchText(source.listingUrl);
  if (!search.ok) throw new Error(`search fetch failed: ${search.error}`);
  save("cl-search.html", search.text);
  const cards = parseClSearchPage(search.text).filter((c) => isSfLocation(c.locationRaw));
  if (cards.length === 0) throw new Error("no SF cards parsed — structure changed?");
  const detail = await fetcher.fetchText(cards[0].url);
  if (!detail.ok) throw new Error(`detail fetch failed: ${detail.error}`);
  save("cl-detail.html", detail.text);
}

async function refreshRentSfNow(): Promise<void> {
  const db = await createDb();
  const source = await db.select().from(sources).where(eq(sources.id, "rentsfnow")).get();
  const baseUrl = source?.baseUrl ?? "https://www.rentsfnow.com";
  const fetcher = new PoliteFetcher({
    requestDelayMs: source?.requestDelayMs ?? 2000,
    timeoutMs: source?.timeoutMs ?? 25000,
    retryCount: 1,
  });
  const body = new URLSearchParams({
    action: "wpas_ajax_load",
    page: "1",
    type: "search",
    city: "San Francisco",
    price: "500,20000",
    minprice: "500",
    maxprice: "20000",
    sort: "post_date-desc",
    view: "list",
    pathName: "available-apartments",
  }).toString();
  const results = await fetcher.fetchText(`${baseUrl}/wp-admin/admin-ajax.php`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${baseUrl}/search/`,
    },
  });
  if (!results.ok) throw new Error(`results fetch failed: ${results.error}`);
  save("rsn-results-p1.html", results.text);
  const page = parseRsnResultsPage(results.text, baseUrl);
  if (page.cards.length === 0) throw new Error("no cards parsed — structure changed?");
  const detail = await fetcher.fetchText(page.cards[0].url);
  if (!detail.ok) throw new Error(`detail fetch failed: ${detail.error}`);
  save("rsn-detail.html", detail.text);
}

async function refreshRentBt(): Promise<void> {
  const db = await createDb();
  const source = await db.select().from(sources).where(eq(sources.id, "brick_and_timber")).get();
  const baseUrl = source?.baseUrl ?? "https://rentbt.com";
  const fetcher = new PoliteFetcher({
    requestDelayMs: source?.requestDelayMs ?? 3000,
    timeoutMs: source?.timeoutMs ?? 25000,
    retryCount: 1,
  });
  const res = await fetcher.fetchText(`${baseUrl}/wp-json/property-search/v1/data/`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`property-search API fetch failed: ${res.error}`);
  const data = JSON.parse(res.text) as BtApiResponse;
  if (!data.apartments?.length) throw new Error("no apartments in feed — structure changed?");
  save("bt-api.json", res.text);
}

async function refreshMosser(): Promise<void> {
  const db = await createDb();
  const source = await db.select().from(sources).where(eq(sources.id, "mosser_living")).get();
  const baseUrl = source?.baseUrl ?? "https://www.mosserliving.com";
  const fetcher = new PoliteFetcher({
    requestDelayMs: source?.requestDelayMs ?? 1500,
    timeoutMs: source?.timeoutMs ?? 25000,
    retryCount: 1,
  });
  const cityRes = await fetcher.fetchText(`${baseUrl}/wp-json/wp/v2/city?per_page=100`, {
    headers: { Accept: "application/json" },
  });
  if (!cityRes.ok) throw new Error(`city fetch failed: ${cityRes.error}`);
  save("mosser-city.json", cityRes.text);
  const sfId = (JSON.parse(cityRes.text) as Array<{ id: number; name: string }>).find(
    (c) => /^san francisco$/i.test((c.name ?? "").trim()),
  )?.id;
  if (!sfId) throw new Error("no San Francisco city term");
  const listRes = await fetcher.fetchText(
    `${baseUrl}/wp-json/wp/v2/rentpress_property?city=${sfId}&per_page=100&_fields=link`,
    { headers: { Accept: "application/json" } },
  );
  if (!listRes.ok) throw new Error(`property list fetch failed: ${listRes.error}`);
  save("mosser-sf-props.json", listRes.text);
  const links = (JSON.parse(listRes.text) as Array<{ link: string }>).map((p) => p.link);
  if (!links.length) throw new Error("no SF property links");
  // Record two representative property pages (first with multiple floorplans).
  const single = await fetcher.fetchText(links[0]);
  if (single.ok) save("mosser-property-single.html", single.text);
  if (links[1]) {
    const multi = await fetcher.fetchText(links[1]);
    if (multi.ok) save("mosser-property-multi.html", multi.text);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  const sourceId = sourceIdx >= 0 ? args[sourceIdx + 1] : null;
  if (!sourceId) {
    console.log(
      "usage: npm run fixtures:refresh -- --source <craigslist_sf|rentsfnow|brick_and_timber|mosser_living>",
    );
    process.exit(1);
  }
  console.log(`Refreshing fixtures for ${sourceId} from the live source…`);
  if (sourceId === "craigslist_sf") await refreshCraigslist();
  else if (sourceId === "rentsfnow") await refreshRentSfNow();
  else if (sourceId === "brick_and_timber") await refreshRentBt();
  else if (sourceId === "mosser_living") await refreshMosser();
  else {
    console.error(`no fixture recipe for ${sourceId}`);
    process.exit(1);
  }
  console.log("Done. Re-run `npm run test:adapters` and update assertions if needed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
