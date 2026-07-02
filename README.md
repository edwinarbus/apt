# Apt — SF apartment scout

A **personal, non-commercial** web app that monitors San Francisco apartment
rental sources, normalizes and dedupes listings, tracks price and availability
changes, flags suspicious listings, and shows everything on an SF map.

Original listings are always the source of truth. The app links back to them
everywhere, never republishes data publicly, never contacts anyone on your
behalf, and fetches politely at low frequency. It is a research/alerting tool
for one person's apartment hunt — nothing more.

> Phase one built the data pipeline + map UI. Phase two hardened it: adapter
> verification, idempotent backfill, confidence-scored dedupe, canonical URLs,
> structured price history, and a source-health dashboard. Phase three added
> the scheduled daily loop with a deterministic saved-search digest and
> Playwright rendering infrastructure for JS-only sources. The app now runs on
> **real data only** (mock removed) across **four working SF adapters**
> (Craigslist, RentSFNow, Brick + Timber, Mosser Living). The latest phases add
> two **optional Claude AI layers**, both off by default and kept entirely
> separate from the deterministic pipeline: **text enrichment** (`npm run
> enrich`, Haiku) for structured amenity/pet/laundry facts, "verify before
> contacting" notes, landlord questions, and a risk second opinion; and **photo
> vision** (`npm run vision`, Haiku) that reads each listing's images into
> searchable visual features. On top of those sits the headline UI: a
> **natural-language AI search** (Sonnet 5) — one big text box (with a voice mic)
> where you type "studio with sunny bay windows within a 5-min walk to a park, in
> the Marina, in-unit laundry and hardwood floors" and Claude ranks the matches,
> blending its own SF neighborhood knowledge with each listing's data,
> description, and vision analysis. All of this requires your own
> `ANTHROPIC_API_KEY` and never overrides the original listing (still the source
> of truth). The core pipeline — ingestion, dedupe, scam heuristics, matching,
> and the digest — remains **fully deterministic** and works with no API key at all.

---

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind 4
- **SQLite** via better-sqlite3 + **Drizzle ORM** (single-file DB in `data/apt.db`;
  schema is flat/portable so a later move to Postgres/PostGIS is mechanical)
- **MapLibre GL** with OpenFreeMap tiles (no API key)
- **cheerio** for HTML parsing; **PoliteFetcher** (HTTP) + **PlaywrightFetcher**
  (headless Chromium) behind one `TextFetcher` interface
- **@anthropic-ai/sdk** + **zod** for the optional Claude AI layers only
  (text enrichment + photo vision) — never imported by the deterministic
  pipeline, and lazy-loaded so the app runs without an API key
- **vitest** for tests (all offline); **tsx** for CLI scripts

## Quick start

```bash
npm install
npx playwright install chromium  # only if you'll enable a JS-rendered source; not needed for the 4 working ones
npm run seed:sources     # upsert the SF source registry (11 sources)
npm run seed:searches    # optional: example saved searches for the digest
npm run ingest -- --all  # ingest every enabled source (Craigslist, RentSFNow, Mosser, Brick + Timber)
npm run dev              # open http://localhost:3000
```

All listings are real. There is no mock/demo data — the app runs entirely on
live SF sources.

The database file (and `drizzle/` migrations) are created automatically on
first use. `data/` is gitignored.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server (map UI at `/`, source dashboard at `/sources`) |
| `npm run seed:sources` | upsert source registry from `src/config/sources.ts` (preserves your enable/disable toggles; `--reset-enabled` restores seed defaults) |
| `npm run seed:searches` | upsert example saved searches so the digest has something to evaluate (edit `scripts/seed-searches.ts` for your own) |
| `npm run ingest -- --all` | run all enabled sources, print a per-source summary |
| `npm run ingest -- --source craigslist_sf` | run one source (explicit id runs even if disabled) |
| `npm run ingest -- --all --no-geocode` | skip network geocoding (neighborhood-centroid fallback still applies) |
| `npm run sources:verify` | verify every source **offline** against recorded fixtures (PASS/PARTIAL/FAIL/SKIPPED); flags: `--source <id>`, `--enabled-only`, `--json`, `--dry-run` (don't persist the verdict), `--live` |
| `npm run sources:verify:live` | live verification of enabled sources — fetches the real sites (capped at 8 detail pages), never writes listings |
| `npm run listings:backfill` | fetch ALL currently available listings from enabled sources with a raised detail budget (400/source); flags: `--source <id>`, `--no-stale-updates`, `--dry-run` (runs against a throwaway DB copy), `--max-detail <n>`, `--no-geocode` |
| `npm run fixtures:refresh -- --source <id>` | re-record fixtures from the live source when its structure changes (`craigslist_sf`, `rentsfnow`, `brick_and_timber`) |
| `npm run digest` | compute the saved-search digest, write a report, mark matches notified; flags: `--dry-run` (repeatable preview), `--json` |
| `npm run daily` | the scheduled loop: ingest all enabled sources, then compute the digest |
| `npm run schedule:install` | write a macOS launchd plist (and print the cron line) to run `npm run daily` on a schedule; flags: `--hour`, `--minute` |
| `npm run enrich -- --dry-run` | **optional AI (Haiku)** — preview which listings would be text-enriched (no key or spend); drop `--dry-run` to call Claude. Flags: `--limit <n>` (default 25), `--all`, `--source-listing <id>`, `--cost-cap <usd>`, `--force`, `--include-inactive`. Needs `ANTHROPIC_API_KEY`. See [AI layers](#ai-layers-optional). |
| `npm run vision -- --dry-run` | **optional AI vision (Haiku)** — preview which listings' photos would be analyzed into searchable features (no key or spend); drop `--dry-run` to call Claude. Same flags as `enrich` plus `--max-images <n>` (default 6). See [AI layers](#ai-layers-optional). |
| `npm test` / `npm run test:adapters` | full vitest suite / just the adapter fixture tests (all offline) |
| `npm run typecheck` / `npm run lint` | strict TS + ESLint |
| `npm run db:generate` | regenerate SQL migrations after editing `src/db/schema.ts` |
| `npm run db:studio` | Drizzle Studio DB browser |

## Verifying the pipeline

`sources:verify` runs each adapter and judges the result against the **adapter
contract** (`src/core/contract.ts`): every listing must have an original URL, a
stable source listing id, and a title; no duplicate URLs/ids within a run;
coverage of price/location/photos is measured and low coverage becomes a
warning. Verdicts:

- **PASS** — no errors, no quality warnings (by-design caveats like
  Craigslist's static-page cap are listed as notes, not demotions)
- **PARTIAL** — pagination incomplete, detail failures, or quality warnings
- **FAIL** — fatal error, zero listings, contract violations, or robots.txt
  disallowing the listing path
- **SKIPPED** — disabled/reference-only/no adapter (with the registry reason)

Verification **never writes listings**. Its only persistence is the verdict on
the source row (shown on the dashboard) — suppress even that with `--dry-run`.
Each report ends with a stale-safety line stating whether a real ingest that
looked like this would be allowed to mark listings missing. The default mode is
offline (fixtures); `--live` fetches the real sources with a hard cap of 8
detail pages, reusing known-listing state so unchanged listings aren't
re-fetched.

## Backfill

`listings:backfill` is the "get everything currently available" command: same
pipeline as `ingest`, but with a raised detail-page budget (default 400) so
detail backlogs converge in one run. It is **idempotent and safe to re-run**:

- upserts key on (source, sourceListingId) — re-runs never create duplicates
- `firstSeenAt` is set once and never reset; `lastSeenAt` refreshes
- price history only gains rows when the observed price actually changed
- nothing is ever deleted; failed/partial runs never mark listings missing
- `--no-stale-updates` disables missing-marking entirely for extra safety
- `--dry-run` copies the SQLite file, runs the complete pipeline against the
  copy (so the printed numbers are exactly what a real run would do), then
  deletes it — the real database provably untouched

## Daily digest & scheduling

`digest` evaluates every enabled saved search against the current live listings
using the deterministic matcher, and reports what's genuinely new since last
time:

- **new matches** — listings that match and were never reported before
- **price drops** — already-reported matches whose price fell
- **dropped out** — matches that stopped matching (price rose, went stale)

It's idempotent: a second run reports nothing new because matches are marked
notified (`--dry-run` previews without marking, so it stays repeatable). Each
run writes a Markdown report to `data/digests/` and records a `digest_runs`
row. Matches are tracked in `saved_search_matches` (first-matched / notified /
still-matching bookkeeping). Unknown fields on a match are surfaced ("verify:
laundry, available_date") rather than hidden — the matcher never guesses.

**It never contacts anyone.** The digest is a local report you read; sending it
anywhere is a manual step you take.

`daily` is the single entry point a scheduler runs: ingest all enabled sources,
then compute the digest. `schedule:install` writes a launchd plist (and prints
the equivalent cron line) — it does **not** touch the system itself; installing
the agent is a command you run:

```bash
npm run schedule:install -- --hour 8
cp data/us.edwinarb.apt.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/us.edwinarb.apt.daily.plist
```

## Rendering JavaScript sources (Playwright)

Some SF property managers render listings client-side. `PlaywrightFetcher`
(`src/core/playwright-fetcher.ts`) is a drop-in `TextFetcher` that renders a
page in headless Chromium and returns the resulting DOM — with optional
`waitForSelector` and `scrollToLoad` (for lazy-loaded grids). The runner and
verifier switch to it automatically for any source whose `needsJavaScript` is
true; robots.txt and server-rendered detail pages still use plain HTTP, so only
the pages that truly need a browser pay for one, and the browser is closed
after each run. Chromium is installed once with `npx playwright install
chromium`.

This is the ready path for the AppFolio PMs (Structure, Gaetani) once they have
inventory. Note: Brick + Timber's JS browse page turned out to be backed by a
clean JSON feed, so its adapter uses that directly instead of rendering — always
prefer a real API to driving a browser.

## AI layers (optional)

Everything above is deterministic and needs no API key. On top of it sit two
**optional** passes that call the Claude API. You run each yourself, they're off
by default, and neither ever changes a deterministic field or the original
listing (still the source of truth):

- **Text enrichment** — `npm run enrich`, Claude **Haiku** — structured facts
  + "verify before contacting" + questions + a risk second opinion, from the
  listing text.
- **Photo vision** — `npm run vision`, Claude **Haiku** — searchable visual
  features from the listing photos, powering natural-language visual search.

Both are isolated behind an injected client interface and stored in their own
tables, so the whole AI surface can be ignored, re-run, or dropped without
touching listing data. Neither runs as part of `npm run daily` — you opt in. No
`ANTHROPIC_API_KEY`, no problem: the app and every deterministic command still
run; only the two commands (without `--dry-run`) need a key, and they error out
with instructions rather than prompting for one. The SDK is lazy-loaded, so
nothing else imports it.

### Setting your API key

Put it in a **gitignored `.env.local`** at the project root — both the CLI
scripts and the Next.js app read it, and `.env*` is already in `.gitignore` so
it's never committed:

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
# optional: APT_ENRICH_MODEL=claude-haiku-4-5 / APT_VISION_MODEL=claude-haiku-4-5
```

(An explicit `export ANTHROPIC_API_KEY=…` in your shell also works and takes
precedence.) On **Vercel**, set the same variable under Project Settings →
Environment Variables (or `vercel env add`); `vercel env pull .env.local` syncs
it back down for local use. The tsx scripts load `.env.local`/`.env` via
`src/lib/load-env.ts` (the app loads them natively).

### Text enrichment (`npm run enrich`)

Per listing, validated against a Zod schema (`src/enrich/schema.ts`):

- a 1–2 sentence neutral **summary** drawn only from the listing text
- structured **amenities / laundry / parking / pet policy / utilities / lease
  term**, extracted from messy free-text (`unknown`/`null` when unstated — never
  guessed)
- **verify before contacting** — concrete things to confirm before you reach out
- **questions for the landlord** — specific to this unit, not boilerplate
- an AI **risk second opinion** (`none`/`low`/`medium`/`high` + neutral reasons)
  that *complements* the deterministic scam heuristics rather than replacing them

```bash
npm run enrich -- --dry-run        # what would be enriched — no key, no spend
export ANTHROPIC_API_KEY=sk-ant-…  # your own key (or `ant auth login`)
npm run enrich -- --limit 10       # enrich up to 10 new/changed listings
npm run enrich -- --source-listing lst_… --force   # re-enrich one listing
npm run enrich -- --all --cost-cap 5   # everything, but stop near $5
```

- **Model:** `$APT_ENRICH_MODEL` (default `claude-haiku-4-5` — cheap and capable
  for this bounded extraction). `APT_ENRICH_MODEL=claude-sonnet-5` for a stronger pass.
- **Cheap to re-run:** keyed on the listing's content hash, so only new/changed
  listings (plus schema-version or error retries) are re-enriched; unchanged
  ones are skipped. Each run reports tokens + estimated USD and honors `--cost-cap`.

### Photo vision & visual search (`npm run vision`)

For each listing with photos, Claude looks at up to `--max-images` of them
(default 6, sent as URLs so the source image hosts aren't re-hit) — **grounded in
the listing's own description + facts** (neighborhood, beds/baths, amenities),
which it uses to name features the way the description does and to flag
photo↔description mismatches, while still only reporting what's actually visible.
It returns, validated against `src/vision/schema.ts`:

- a short **observational summary** of what the photos actually show
- **visual feature tags** — "hardwood floors", "bay windows", "stainless steel
  appliances", … only what's clearly visible, never inferred
- **per-room notes** and an overall **condition** impression
- neutral **notes** for anything verifiable in the images (e.g. a visible
  watermark) — never a fraud accusation

Those become a denormalized search blob (features + summary + rooms) and the
promoted `features` tags, which feed the [AI search](#ai-search-natural-language)
as one of its four signals — so a query like "hardwood floors and bay windows"
matches on what the photos actually show. Listings you've run `npm run vision`
on rank on their visual features; the rest fall back to text + data.

```bash
npm run vision -- --dry-run          # what would be analyzed — no key, no spend
npm run vision -- --limit 10         # analyze up to 10 new/changed listings
npm run vision -- --max-images 4     # send at most 4 photos each
npm run vision -- --all --cost-cap 5 # everything, but stop near $5
```

- **Model:** `$APT_VISION_MODEL` (default `claude-haiku-4-5` — cheap and capable
  for bounded visual extraction).
- **Cheap to re-run:** keyed on the listing's `photoHash`, so a listing is only
  re-analyzed when its photos change (plus schema-version/error retries).
  No-photo listings are skipped. Same `--limit` / `--force` / `--include-inactive`
  flags as enrich.
- **Backfill now, agent later:** this is the backfill path. The same
  `runVision()` selection + write logic is what a future managed agent will call
  per new listing it picks up (see [Next steps](#next-steps)).

### How it's kept safe and honest

- **Untrusted input:** listing text is wrapped in `<listing>…</listing>` and the
  system prompts state that scraped text — and any text *inside a photo* — is
  *data to analyze, never instructions*. A description that says "ignore previous
  instructions" is flagged as a risk signal, not obeyed (there's a test for the
  enrichment case).
- **The project's rules are in the prompts:** use only what's actually there;
  `null`/omit when unknown; **never** infer protected-class or demographic
  characteristics (vision additionally never describes people in photos);
  **never** assert fraud/scam/illegality as fact — risk and notes fields are
  neutral, observable flags for a human to verify.
- **Clearly labeled in the UI:** the detail modal shows enrichment under
  **✦ AI notes** and vision under **✦ What the photos show**, each with the model
  name and a "may be wrong — verify with the original" disclaimer, visually
  distinct from the deterministic facts grid.
- **Isolated storage:** `listing_enrichment` and `listing_vision`, one row per
  listing, keyed by hash + schema version + model — droppable without touching
  listing data.
- **Testable without the network:** each layer talks to Claude through a small
  client interface (`EnrichmentClient` / `VisionClient` / `SearchClient`); every
  AI test injects a fake client, so the suite stays 100% offline.

## AI search (natural language)

The primary way to find a place: one big text box (with a **mic** — browser
speech, no key) where you describe what you want in plain English —

> studio with sunny bay windows within a 5-min walk to a park, in the Marina,
> in-unit laundry and hardwood floors

— and Claude finds and ranks the matches, each with a one-line "why". It blends
**four signals**: the model's own **SF neighborhood/geography knowledge** (which
areas count as "the Marina", where the parks and transit are, rough walk times),
the listing's **structured data**, its **description**, and its **photo-vision
features**. Results render on the map + list ordered by an AI match score, with
the parsed criteria shown as chips ("Understood as: …").

**Location.** On load the app asks for your browser location (default **10-mi**
radius, adjustable) and uses it as a hard distance filter; deny it and search
just runs city-wide.

**How it runs** (`POST /api/search`, `src/search/`):
1. Assemble active, non-hidden candidates (within radius), each a compact
   profile: data + amenities + vision features/summary + a description snippet
   (+ distance from you).
2. Locally pre-rank by query-term overlap and **cap to 60** — this keeps it one
   fast, reliable model call instead of dumping 600 listings into the prompt
   (which was both slow and prone to truncation).
3. Claude (**Sonnet 5**) ranks those, returning `{interpretation, intentChips,
   matches:[{id, score, reason}]}`; hallucinated ids are dropped and scores clamped.

The route **streams NDJSON progress** (candidates assembled → shortlist with
its actual ids → model reading → output growing → final result), and the UI
renders it as a live ops display: a **tactical radar of San Francisco** where
every blip is a real active listing at its true coordinates, a sweep beam
pings them as it passes, and once the server streams the shortlist the
reticle locks target-by-target onto the exact listings Claude is reading —
alongside a stage feed with animated checkmarks and a live reasoning ticker.
Real pipeline events only; results then stagger in with per-listing score
rings. Works in Safari too — verified end-to-end on the WebKit engine (speech
input degrades gracefully where the browser doesn't offer it). Note: search
explicitly disables extended thinking (`thinking: {type: "disabled"}`) —
Sonnet 5 defaults to adaptive thinking, which added 30–60s and could consume
the whole token budget before any output.

**Model / cost / speed.** `$APT_SEARCH_MODEL` (default `claude-sonnet-5`, the
quality choice). A search is one call (~1–3¢) and takes ~15–30s — it's genuinely
reading and reasoning over ~60 listings. Set `APT_SEARCH_MODEL=claude-haiku-4-5`
for a much faster, cheaper search that's a little less sharp on geography. Needs
`ANTHROPIC_API_KEY` (same `.env.local`); voice uses the browser's built-in Web
Speech API, so no extra key. Proximity ("5-min walk to a park") is the model's
honest estimate from general SF knowledge — named in the reason, not a routed
measurement.

## Architecture

```
src/
  core/         domain logic, no I/O side effects (all unit-tested)
    types.ts       shared enums + NormalizedListing (the adapter contract)
    normalize.ts   price/beds/baths/sqft/laundry/parking/pets/concession parsers
    hash.ts        content/description/photo hashing (photo keys survive resizes)
    neighborhoods.ts  canonical SF hoods + centroids + Craigslist alias mapping
    fetcher.ts     PoliteFetcher (HTTP) + TextFetcher/FetchInit interfaces
    playwright-fetcher.ts  browser-rendering TextFetcher for JS-only sources
    robots.ts      robots.txt fetch/parse/evaluate (recorded per source)
    stale.ts       cautious missing-listing lifecycle + processing gate
    scam.ts        deterministic "verify carefully" heuristics + price baselines
    dedupe.ts      union-find duplicate grouping, 6 signals + confidence tiers
    urls.ts        listing-URL canonicalization (dedupe exact-match key)
    contract.ts    structural adapter-contract validation + coverage stats
    match.ts       deterministic saved-search evaluation (returns unknowns separately)
    geocode.ts     Nominatim w/ permanent cache + neighborhood-centroid fallback
    contact.ts     listing-overrides-source contact resolution
  adapters/     one module per source system
    types.ts       AdapterContext/AdapterRunResult contract
    registry.ts    adapterType -> implementation
    craigslist.ts  static search page + detail pages
    rentsfnow.ts   WP admin-ajax results + unit detail pages
    rentbt.ts      Brick + Timber via wp-json property-search feed (JSON)
    mosser.ts      Mosser Living via RentPress embedded data-floorplans blobs
  ingest/
    upsert.ts      merge rules, price/content-change events, precision guards
    runner.ts      robots -> adapter -> upserts -> status -> stale -> dupes ->
                   scam -> geocode -> SourceRun record
    verify.ts      adapter verification (fixture/live) -> PASS/PARTIAL/FAIL/SKIPPED
    digest.ts      deterministic saved-search digest (new / price-drop / dropped)
  enrich/       OPTIONAL Claude text layer (imported by nothing in the pipeline)
    schema.ts      Zod enrichment schema + prompt schema description + versioning
    client.ts      EnrichmentClient interface, prompt (injection-guarded)
    enricher.ts    candidate selection (contentHash/version-aware) + write orchestration
  vision/       OPTIONAL Claude vision layer (also pipeline-independent)
    schema.ts      Zod vision schema + searchText builder + versioning
    client.ts      VisionClient interface, image-URL blocks, injection-guarded prompt
    vision.ts      photoHash-aware selection + image capping + write orchestration
  search/       AI natural-language search (Claude ranks; pipeline-independent)
    schema.ts      Zod output schema + CandidateProfile (the 4-signal profile)
    client.ts      SearchClient interface + neighborhood-aware ranking prompt (streamed)
    search.ts      candidate assembly (radius/vision) + local pre-rank cap + orchestration
  lib/
    ai-cost.ts     shared per-model token→USD estimation (enrich / vision / search)
    load-env.ts    .env.local loader for the CLI scripts
    api-types.ts   wire types shared between API routes and client components
  config/sources.ts  the seed registry (URLs, politeness params, status notes)
  db/            drizzle schema + client (WAL, auto-migrate)
  app/           Next.js pages + JSON API routes
  components/    map, panel, cards, detail modal, source dashboard
scripts/         seed / ingest / verify / backfill / digest / daily / schedule / enrich CLIs
tests/           vitest suites + tests/helpers.ts (in-memory DB + stub adapter)
fixtures/        recorded HTML/JSON from real sources (tests never hit the network)
```

### Data model (SQLite, portable to Postgres)

- **sources** — registry with per-source politeness config (`requestDelayMs`,
  `maxPagesPerRun`, `maxDetailPagesPerRun`, `timeoutMs`, `retryCount`,
  `crawlIntervalHours`), operational status (`robotsStatus`, `permissionStatus`,
  `needsJavaScript`, `blocksAutomation`, `safeForPersonalLowFrequencyFetching`)
  and human notes. Source-level contact info lives here and is inherited by
  listings unless a listing publishes its own.
- **listings** — one row per (source, sourceListingId). Every normalized field
  keeps its raw twin (`priceRaw`/`priceMonthly`, `bedroomsRaw`/`bedrooms`, …);
  unknown stays `null`, never guessed. Includes `contentHash`,
  `descriptionHash`, `photoHash`, `duplicateGroupId`, `scamRiskLevel` +
  `scamWarnings`, `staleStatus`, `geocodePrecision`
  (`exact_address | building | block | neighborhood | city | unknown`), and the
  full `rawPayload` for parser debugging.
- **source_runs** — one row per attempted run: status
  (`success | partial | failed | skipped`), counts (found/new/changed/price-
  changed/missing/duplicates/scams), `pagesVisited`, `detailPagesVisited`,
  `totalListingsReportedBySource`, `paginationCompleted`,
  `detailExtractionCompleted`, `staleProcessed`, `warnings[]`, a full
  `paginationTrace` (per-page URL/status/count), `htmlHash`, and the raw-debug
  directory path.
- **listing_events** — audit log: `first_seen`, `price_change` (old/new),
  `content_change`, `stale_change`, `listing_status_change`, `reappeared`.
- **price_history** — structured history: one row at first sight (baseline,
  even when the price is unparseable — the raw text is the observation) and
  one per observed change of price or effective price, with `priceRaw`,
  `priceMonthly`, `priceEffectiveMonthly`, `concessionsRaw`, `depositRaw`,
  `observedAt`, and the `sourceRunId` that saw it. Unchanged re-runs add
  nothing. The detail view renders it (current, previous, first-seen price);
  cards badge recent drops/increases.
- **user_listing_states** — your status per listing: `saved | hidden |
  contacted | not_a_fit | maybe | toured | applied | rented_elsewhere |
  suspicious` + note.
- **saved_searches** — named `SavedSearchCriteria` JSON, evaluated by the
  deterministic matcher and the digest.
- **saved_search_matches** — one row per (search, listing) with first-matched /
  notified / still-matching bookkeeping, so the digest surfaces only genuinely
  new matches and price drops.
- **digest_runs** — audit record for each digest.
- **geocode_cache** — permanent per-address cache (negative results included) so
  no address is ever geocoded twice.
- **duplicate_groups** — group id, confidence, reasons, members, primary.
- **listing_enrichment** — optional AI text layer, one row per listing: `model`,
  `schemaVersion`, `contentHashAtEnrichment` (drives cheap re-runs), `summary`,
  `aiRiskLevel`, the full validated `data` JSON, token counts + `costUsd`, and
  `error`. Entirely separate from the deterministic tables; safe to drop.
- **listing_vision** — optional AI vision layer, one row per listing: `model`,
  `schemaVersion`, `photoHashAtVision` (re-analyze only when photos change),
  `imageCount`, `visualSummary`, promoted `features`, a denormalized lowercased
  `searchText` (a signal the AI search ranks on), the full `data` JSON,
  token counts + `costUsd`, and `error`. Also separate and safe to drop.

## Sources

Every registry entry carries a `registryStatus` classification and a
last-verification verdict (persisted by `sources:verify`, shown on the
dashboard). Current state, verified live 2026-07-02:

| Source | Registry status | Verification |
| --- | --- | --- |
| `craigslist_sf` | enabled_working | **PASS** (live + fixtures) |
| `rentsfnow` | enabled_working | **PASS** (live + fixtures) |
| `brick_and_timber` | enabled_working | **PASS** (live + fixtures) |
| `mosser_living` | enabled_working | **PASS** (live + fixtures) |
| `zillow_sf`, `apartments_com_sf` | disabled_reference_only | SKIPPED by design |
| `structure_properties` | disabled_needs_adapter (classic AppFolio widget, **currently zero inventory**) | SKIPPED |
| `gaetani_real_estate` | disabled_needs_adapter (AppFolio v2 UI, currently empty) | SKIPPED |
| `trinity_sf` | disabled_needs_review (public site exposes no machine-readable availability, even rendered) | SKIPPED |
| `lapham_company` | disabled_blocked_or_not_practical (inventory is East Bay, not SF) | SKIPPED |
| `ballast_investments` | disabled_needs_review (no public listing page identified) | SKIPPED |

### Working adapters

| Source | Status | How it works |
| --- | --- | --- |
| **Craigslist SF** (`craigslist_sf`) | ✅ working, enabled | The search URL serves a static no-JS fallback of ~360 newest results (`li.cl-static-search-result`). Non-SF results (Oakland etc., incl. "South San Francisco") are filtered by location text. Detail pages are classic server-rendered HTML: coordinates + accuracy, address (`.mapaddress`), labeled attributes (pets, laundry, parking, housing type), availability, photos (`imgList`), posted/updated times, description. Detail pages are fetched **only for new or price-changed postings**, capped by `maxDetailPagesPerRun` (default 50/run). robots.txt (checked at run time and recorded) currently disallows only `/reply`, `/fb/`, `/suggest`, `/flag`, `/mf`, `/mailflag`, `/eaf` — not search or posting pages. |
| **RentSFNow** (`rentsfnow`) | ✅ working, enabled | WordPress site whose own search UI POSTs to `/wp-admin/admin-ajax.php` (`action=wpas_ajax_load`); we send the same request filtered to San Francisco and get server-rendered cards with explicit `current_page`/`last_page` markers (trustworthy pagination) plus building-level coordinates from the embedded map-markers array. Unit detail pages add sqft, description, amenities, photo gallery. Detail fetches use the same only-new-or-changed rule. |
| **Brick + Timber** (`brick_and_timber`) | ✅ working, enabled | SF property manager at rentbt.com. The browse page is a JS-rendered WordPress + RentCafe app, but it's backed by a clean public REST feed (`/wp-json/property-search/v1/data/`) returning every available unit as structured JSON in **one request** — price, beds/baths/sqft, unit, building address, **exact coordinates**, neighborhood, amenities, concessions, full photo gallery, application URL. The adapter uses that directly (no browser, no pagination, no detail pages). The feed includes East Bay units; the adapter filters to SF by building city. Single complete response → missing-listing tracking runs safely; exact coords → no geocoding needed. |
| **Mosser Living** (`mosser_living`) | ✅ working, enabled | Large SF property manager on a RentPress (WordPress) stack. One `wp-json` call lists the ~60 SF properties (filtered by the "San Francisco" city taxonomy term), and each property page embeds a complete `data-floorplans='[...]'` JSON blob in its raw HTML — per-floorplan rent/beds/baths/sqft/availability/photos plus the property's address, **exact coordinates**, neighborhood, amenities, pet policy, and contact info. Plain HTTP, no browser. Listings are **floorplan-level** (each available floorplan = one listing); the floorplan name is used as the unit discriminator so distinct floorplans at one building aren't mistaken for duplicates. Fetches the SF property pages each run (capped by `maxDetailPagesPerRun`, default 80); complete set → missing-listing tracking runs safely. Feed spans SF/Oakland/LA; filtered to SF. |

### Seeded but disabled (audited 2026-07-02)

- **Zillow / Apartments.com** — reference-only by design (`permissionStatus:
  reference_only_do_not_fetch`). Heavy anti-automation; not a sane foundation
  for a polite personal scraper. Use manually in a browser to cross-check.
- **Structure Properties** (AppFolio) — rendered with Playwright and confirmed
  the classic "snowfolio" widget, but it currently shows "no available
  properties" (zero inventory). A parser can't be verified against an empty
  page, so the adapter is deferred until it (or another classic-widget SF
  AppFolio PM) has live units. The Playwright infra is ready for that moment.
- **Gaetani** (AppFolio) — uses AppFolio's newer v2 UI (different markup from
  Structure) and is also currently empty.
- **Trinity SF** — re-investigated including a Playwright render: the homepage
  and neighborhood pages expose no availability or pricing even when rendered
  (only a hy.ly chat widget), and there's no JSON feed. Its live availability
  lives in a separate leasing system not reachable from the public site. No
  adapter is feasible until that source is found.
- **Lapham** — reachable and even server-rendered, but current inventory is
  Oakland/Berkeley/Danville, not SF. Not practical for this tool.
- **Ballast** — no public listing page identified.

Every source records robots.txt status (re-checked weekly at run time),
permission notes, JS requirements, and whether it looks safe for personal
low-frequency fetching. These are **operational notes, not legal conclusions**.
No new source was added in phase two: the policy is one addition only if it's
straightforward, and every candidate needs JS work.

## How the pipeline behaves

### Ingestion & change tracking
- Upserts key on `(sourceId, sourceListingId)`; `firstSeenAt` on insert,
  `lastSeenAt` refreshed every time a listing is seen.
- Price changes produce `price_change` events with old/new values; other
  meaningful changes produce `content_change` (detected via `contentHash`,
  which ignores photo-size churn).
- Card-depth refreshes never wipe detail fields; parsed nulls never clobber
  previously known values (the newest raw payload is stored regardless).
- Coordinates only improve: a neighborhood-centroid fix never overwrites an
  exact address fix.

### Stale/missing lifecycle (cautious by design)
`active → missing_once → missing_multiple_runs → likely_unavailable`, one step
per qualifying run, `missingSince` recorded, reappearance snaps back to
`active` with an event. The chain advances **only** after a run that was fully
successful **and** whose pagination completeness was verified. Failed runs,
partial runs, zero-listing runs, and unknown-pagination runs never mark
anything missing. Consequence worth knowing: Craigslist's static page caps at
~360 results, so its pagination completeness is usually "unknown" and CL
listings are *not* auto-marked missing by absence — they leave via detail-page
removed/expired detection (checked when a listing's price changes) or manual
action. RentSFNow reports `last_page`, so its missing tracking is fully live.

### Pagination auditing
Every run stores a `paginationTrace` (per-page URL, HTTP status, extracted
count, notes), `totalListingsReportedBySource` when the source states one,
`paginationCompleted`, and warnings whenever counts look wrong (zero listings,
sharp drops vs. the previous successful run, photo-extraction collapse, early
stops, detail budget exhaustion). The sources dashboard shows all of it.

### Duplicate detection (with confidence)
Union-find grouping across sources on six signals, each carrying a
confidence; a group's confidence is its strongest signal:

| Signal | Confidence |
| --- | --- |
| same canonical original URL | exact |
| same normalized address + unit number | high |
| same address + price + beds + baths (units must not conflict) | high |
| shared photo identity, matching units (same-source only) | medium |
| same description hash (units must not conflict) | medium |
| same title + price + neighborhood | low |

Guards learned from live data: units in one building share building/amenity
photos and per-building boilerplate descriptions, so photo links require
matching unit numbers and description links are skipped when units explicitly
differ. Same-source photo/description matches across *different* source
listing ids are additionally tagged `repost_candidate` (the delete-and-repost
pattern). Listings are grouped, **never merged** — each `duplicate_groups` row
stores confidence, reasons, member ids, and a `primaryListingId` (the active,
freshest, richest record). Groups are recomputed db-wide after every run and
pruned when they dissolve. The detail view shows the confidence chip, the
matching reasons, "also seen on <source>", and links to every peer.

### Canonical URLs
`src/core/urls.ts` canonicalizes original URLs for the exact-dupe signal:
known tracking params (`utm_*`, `fbclid`, `gclid`, …) and fragments are
stripped; scheme/host casing, default ports, duplicate slashes, and trailing
slashes are normalized; identifying query params are **preserved** (sorted)
so distinct listings addressed by query string never collapse together.
Stored on each listing as `canonicalUrl`.

### Suspicious-listing flags
Deterministic signals only, and deliberately non-accusatory ("verify
carefully", never "fraud"): price far below the median for that
neighborhood+bedroom bucket (live medians when ≥8 data points, otherwise a
conservative static citywide table), too-good sqft/price combos, wire-transfer
/ payment-before-viewing language, the classic owner-abroad pattern, duplicate
descriptions across different neighborhoods, urgency pressure, missing
photos/location, spammy title symbols. One strong signal (or two weak ones) →
`verify_carefully`; a single weak signal → `watch`. Signals are listed
verbatim in the detail view with a "heuristics, not conclusions" note.

### Geocoding
Craigslist detail pages and RentSFNow markers provide real coordinates with
recorded precision. Listings with an address but no coordinates go through
Nominatim (OpenStreetMap) — ≤1 request/1.1s, identifying User-Agent, capped
per run, permanently cached including negative results. Everything else falls
back to neighborhood centroids with precision `neighborhood`; the map renders
those ghosted and the UI labels them "approximate".

### Matching
`src/core/match.ts` evaluates a listing against `SavedSearchCriteria` (price,
beds/baths, sqft, $/sqft, neighborhoods, pets, laundry, parking, available-by
date, radius from a point, include/exclude keywords) and returns `failed`
criteria and `unknowns` separately — a listing that matches everything known
but has an unknown pet policy says so instead of silently passing or failing.
User-hidden / not-a-fit / rented-elsewhere listings are ineligible. Example
saved searches are seeded by `seed:searches`. No AI scoring — by design;
matching only uses concrete user preferences, never demographic or
protected-class proxies.

## UI

- **Map** (`/`) — MapLibre over OpenFreeMap Positron tiles. Clustered markers,
  color-coded by status (new today, price drop, verify carefully, saved,
  contacted, missing/stale), price labels at higher zooms, approximate
  locations ghosted, legend bottom-left. Right panel: photo cards with price
  (effective price when concessions parse), beds/baths/sqft, neighborhood,
  badges, source attribution, last-checked time, and — when a search is active —
  its **AI match score and one-line reason**. The top bar is one big
  **natural-language search box** (with a browser-speech mic): describe what you
  want and Claude ranks the matches (see [AI search](#ai-search-natural-language)),
  ordered by match score; a location chip (browser geolocation + adjustable
  radius) and a show-hidden/gone toggle sit beneath it. Click a card or marker
  for the detail modal: gallery, badge row,
  user-status actions (saved/maybe/contacted/toured/applied/not-a-fit/hidden/
  suspicious), a **verify-before-acting callout**, suspicious-signal list, an
  optional **✦ AI notes** block (summary, verify-before-contacting, questions
  for the landlord, AI risk second opinion + a "may be wrong" disclaimer — only
  shown when the listing has been enriched), an optional **✦ What the photos
  show** block (vision summary, visible-feature chips, per-room notes, condition
  + disclaimer — only when the listing has been vision-analyzed), facts grid
  with raw values on hover, description, amenities, duplicate peers, full event
  history, source & contact block (source-level contact inherited unless the
  listing overrides), and the original-listing button.
- **Sources** (`/sources`) — per-source health: an overall status chip
  (PASS / PARTIAL / FAIL / SKIPPED / DISABLED / REFERENCE_ONLY / NEEDS_REVIEW,
  derived from the registry classification, the last verification verdict, and
  the last run), adapter-verification line with timestamp, last successful
  run, listing counts with a trend arrow vs the previous run, robots/permission
  status, JS/automation flags, last-run summary (counts incl. duplicates and
  price changes, pages, pagination ✓/✗/?, missing-tracking ran or not,
  warnings, errors), notes, and run history.

### Raw debug artifacts

Every run saves its first results page under `data/raw/<source>/<runId>/`.
Failed and partial runs additionally save `fetch-trace.json` (every request
with status/latency/bytes) and `normalized-listings.json` (the extracted
listings plus contract issues and warnings), and the run row stores the
pagination trace and the debug directory path — enough to diagnose a broken
parser without re-fetching anything.

## Politeness & constraints

- Per-source `requestDelayMs` between requests, bounded retries with backoff,
  page and detail-page caps per run, manual/daily cadence — no polling.
- Detail pages are only fetched for new or visibly changed listings.
- robots.txt is checked and respected (disallowed → run is skipped and
  recorded as such).
- Raw HTML snapshots are saved under `data/raw/<source>/<run>/` for parser
  debugging.
- No automated outreach of any kind. No public republishing. Contact info is
  only what the source publishes. Original listing links everywhere.

## Tests

`npm test` — 207 tests, all offline (recorded fixtures in `fixtures/`):
parsers, hashing, URL canonicalization, neighborhoods (including the
South-San-Francisco trap), stale lifecycle + the failed/partial-run guard +
the `--no-stale-updates` flag, dedupe signals with confidence tiers and
unit-number guards, repost tagging, primary-listing selection, the adapter
contract, verification reports (PASS/PARTIAL/FAIL/SKIPPED, including
fixture-mode verification of all four real adapters end to end), scam
heuristics, saved-search matching, the digest (idempotent new-match reporting,
price-drop and dropped-out detection, user-exclusion), geocode caching +
fallback precision, price-history recording (baseline, changes, no redundant
rows, unparseable prices), backfill idempotency (repeat runs: no duplicates,
firstSeenAt and history preserved), the Playwright renderer (against a local
data: URL — auto-skips if Chromium isn't installed), and the AI layers —
enrichment (schema parsing/validation, cost estimation, untrusted-input
wrapping), vision (schema parsing, grounded-context building, image
dedupe/http-filter/cap, photoHash-aware selection), and search (haversine
distance, radius + view-state candidate assembly, the local relevance
pre-rank/cap, hallucinated-id guarding and score clamping) — each talking to
Claude through an injected fake client, so the suite never touches the network.
`npm run test:adapters` runs just the adapter fixture suites.

## Known limitations

- **Craigslist static cap**: each run sees the ~360 newest SF postings; older
  live postings beyond the cap are invisible, so CL missing-tracking is
  intentionally conservative (see lifecycle section). The JS search API could
  lift this later if an acceptable approach is verified.
- **Daily-run detail backlog**: normal `ingest` runs cap Craigslist at 50
  detail pages per run; `listings:backfill` (budget 400) converges the backlog
  in one pass. Card-depth listings have title/price/hood with
  neighborhood-level coordinates until their details are fetched.
- Cross-source duplicate detection relies on URL/address/title/description —
  photo matching across sources needs perceptual hashing (future).
- Near-identical (but not hash-identical) description matching is not
  implemented; the description signal requires exact normalized-text equality.
- Effective-price math assumes a 12-month term when amortizing "N weeks/months
  free" (raw concession text always preserved).
- Single-user, no auth, local SQLite — by design.
- The digest surfaces matches but does not send them anywhere — reading the
  report (or wiring your own delivery) is manual, by design.
- Brick + Timber is premium inventory; most units sit well above typical
  saved-search price ceilings, so a narrow search may match few or none of
  them — that's correct, not a bug.
- AppFolio adapters (Structure, Gaetani) are deferred until those PMs have live
  inventory; the Playwright infra to build them is in place.

## Adding a new source adapter

1. Probe the source manually (curl the listing page; check robots.txt; find
   where the data actually lives — server HTML, ajax endpoint, embedded JSON).
   Save a snapshot into `fixtures/`.
2. Add a registry entry in `src/config/sources.ts` (start `enabled: false`)
   with honest `sourceStatusNotes` about what you verified.
3. Implement `SourceAdapter` in `src/adapters/<name>.ts`: fetch all pages via
   `ctx.fetcher`, respect `maxPagesPerRun`/`maxDetailPagesPerRun`, use
   `ctx.knownListings` to skip unchanged detail pages, return
   `NormalizedListing`s (raw + normalized fields, nulls for unknowns, rich
   `rawPayload`) plus an accurate `pageTrace`/`paginationCompleted`.
4. Register it in `src/adapters/registry.ts`.
5. Add fixture-based tests; run `npm run seed:sources` and
   `npm run ingest -- --source <id>`; watch the dashboard warnings.

## Next steps

1. **Digest delivery** — the digest writes a local report today. Add an opt-in
   delivery you control (write to a file the UI reads, or a manual "email me
   this" button), keeping the "never auto-contact anyone" rule intact.
2. **AppFolio adapter via Playwright** (`structure_properties`,
   `gaetani_real_estate`) once they have inventory — the rendering
   infrastructure is built and wired to `needsJavaScript`; only the parser
   (classic snowfolio for Structure, v2 for Gaetani) remains, to be written
   against live markup.
3. **Claude AI layers** — ✅ built (see [AI layers](#ai-layers-optional)): text
   **enrichment** (`npm run enrich`, Haiku) and **photo vision** +
   natural-language visual search (`npm run vision`, Haiku), both opt-in and
   isolated behind injected client interfaces.
4. **Managed agent for new listings** — the intended next step. Today `npm run
   vision` / `npm run enrich` are manual backfill passes; a Managed Agent (or a
   scheduled workflow) should run enrichment + vision automatically on each new
   or changed listing the pipeline picks up, reusing the same `runVision()` /
   `enrichListings()` selection + write logic (they're already keyed on
   photoHash / contentHash, so the agent just calls them per listing). This is
   where server-managed sessions and a persisted agent config earn their keep.
5. **More AI follow-ons** — match explanations in the digest ("matches except
   pet policy is unknown"), AI adjudication of medium/low-confidence dedupe
   groups, and surfacing enrichment/vision features in the card list (both are
   detail-only today). Each reuses an existing client seam and stays clearly
   labeled and non-authoritative.
