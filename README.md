# Apt — SF apartment scout

A **personal, non-commercial** web app that monitors San Francisco apartment
rental sources, normalizes and dedupes listings, tracks price and availability
changes, flags suspicious listings, and shows everything on an SF map.

Original listings are always the source of truth. The app links back to them
everywhere, never republishes data publicly, never contacts anyone on your
behalf, and fetches politely at low frequency. It is a research/alerting tool
for one person's apartment hunt — nothing more.

> Phase one is the data pipeline + map UI. A future phase may add Claude-based
> enrichment (daily summaries, match explanations, scam analysis); the schema
> and runner were designed so an agent can operate on top of them, but nothing
> AI-related is built or wired up yet.

---

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind 4
- **SQLite** via better-sqlite3 + **Drizzle ORM** (single-file DB in `data/apt.db`;
  schema is flat/portable so a later move to Postgres/PostGIS is mechanical)
- **MapLibre GL** with OpenFreeMap tiles (no API key)
- **cheerio** for HTML parsing; plain `fetch` with politeness controls
- **vitest** for tests; **tsx** for CLI scripts
- No Playwright yet — both phase-one adapters work against server-rendered
  HTML. The AppFolio sources seeded as disabled will need it later.

## Quick start

```bash
npm install
npm run seed:sources     # upsert the SF source registry (12 sources)
npm run seed:mock        # optional: realistic demo data through the real pipeline
npm run ingest -- --all  # ingest every enabled source (Craigslist + RentSFNow)
npm run dev              # open http://localhost:3000
```

The database file (and `drizzle/` migrations) are created automatically on
first use. `data/` is gitignored.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server (map UI at `/`, source dashboard at `/sources`) |
| `npm run seed:sources` | upsert source registry from `src/config/sources.ts` (preserves your enable/disable toggles; `--reset-enabled` restores seed defaults) |
| `npm run seed:mock` | run the mock adapter through the real pipeline 4× to simulate price drops, disappearances, and new listings; adds example user statuses + a saved search |
| `npm run ingest -- --all` | run all enabled sources, print a per-source summary |
| `npm run ingest -- --source craigslist_sf` | run one source (explicit id runs even if disabled) |
| `npm run ingest -- --all --no-geocode` | skip network geocoding (neighborhood-centroid fallback still applies) |
| `npm test` / `npm run test:watch` | vitest suite (~100 tests, fixture-based, no network) |
| `npm run typecheck` / `npm run lint` | strict TS + ESLint |
| `npm run db:generate` | regenerate SQL migrations after editing `src/db/schema.ts` |
| `npm run db:studio` | Drizzle Studio DB browser |

## Architecture

```
src/
  core/         domain logic, no I/O side effects (all unit-tested)
    types.ts       shared enums + NormalizedListing (the adapter contract)
    normalize.ts   price/beds/baths/sqft/laundry/parking/pets/concession parsers
    hash.ts        content/description/photo hashing (photo keys survive resizes)
    neighborhoods.ts  canonical SF hoods + centroids + Craigslist alias mapping
    fetcher.ts     PoliteFetcher: per-source delay, timeout, bounded retries
    robots.ts      robots.txt fetch/parse/evaluate (recorded per source)
    stale.ts       cautious missing-listing lifecycle + processing gate
    scam.ts        deterministic "verify carefully" heuristics + price baselines
    dedupe.ts      union-find duplicate grouping across 4 signals
    match.ts       deterministic saved-search evaluation (returns unknowns separately)
    geocode.ts     Nominatim w/ permanent cache + neighborhood-centroid fallback
    contact.ts     listing-overrides-source contact resolution
  adapters/     one module per source system
    types.ts       AdapterContext/AdapterRunResult contract
    registry.ts    adapterType -> implementation
    craigslist.ts  static search page + detail pages
    rentsfnow.ts   WP admin-ajax results + unit detail pages
    mock.ts        28-listing dev dataset with 2 lifecycle phases
  ingest/
    upsert.ts      merge rules, price/content-change events, precision guards
    runner.ts      robots -> adapter -> upserts -> status -> stale -> dupes ->
                   scam -> geocode -> SourceRun record
  config/sources.ts  the seed registry (URLs, politeness params, status notes)
  db/            drizzle schema + client (WAL, auto-migrate)
  app/           Next.js pages + JSON API routes
  components/    map, panel, cards, detail modal, source dashboard
scripts/         seed-sources / seed-mock / ingest CLIs
tests/           vitest suites + tests/helpers.ts (in-memory DB + stub adapter)
fixtures/        recorded HTML from real sources (tests never hit the network)
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
- **listing_events** — history: `first_seen`, `price_change` (old/new),
  `content_change`, `stale_change`, `listing_status_change`, `reappeared`.
  Price history is the sequence of `price_change` events.
- **user_listing_states** — your status per listing: `saved | hidden |
  contacted | not_a_fit | maybe | toured | applied | rented_elsewhere |
  suspicious` + note.
- **saved_searches** — named `SavedSearchCriteria` JSON (schema + deterministic
  matcher exist; alerting is deliberately not built yet).
- **geocode_cache** — permanent per-address cache (negative results included) so
  no address is ever geocoded twice.
- **duplicate_groups** — group id + signals that formed it.

## Sources

### Working adapters

| Source | Status | How it works |
| --- | --- | --- |
| **Craigslist SF** (`craigslist_sf`) | ✅ working, enabled | The search URL serves a static no-JS fallback of ~360 newest results (`li.cl-static-search-result`). Non-SF results (Oakland etc., incl. "South San Francisco") are filtered by location text. Detail pages are classic server-rendered HTML: coordinates + accuracy, address (`.mapaddress`), labeled attributes (pets, laundry, parking, housing type), availability, photos (`imgList`), posted/updated times, description. Detail pages are fetched **only for new or price-changed postings**, capped by `maxDetailPagesPerRun` (default 50/run). robots.txt (checked at run time and recorded) currently disallows only `/reply`, `/fb/`, `/suggest`, `/flag`, `/mf`, `/mailflag`, `/eaf` — not search or posting pages. |
| **RentSFNow** (`rentsfnow`) | ✅ working, enabled | WordPress site whose own search UI POSTs to `/wp-admin/admin-ajax.php` (`action=wpas_ajax_load`); we send the same request filtered to San Francisco and get server-rendered cards with explicit `current_page`/`last_page` markers (trustworthy pagination) plus building-level coordinates from the embedded map-markers array. Unit detail pages add sqft, description, amenities, photo gallery. Detail fetches use the same only-new-or-changed rule. |
| **Mock SF** (`mock_sf`) | ✅ dev-only, disabled | 28 realistic listings exercising every edge case (missing fields, broken photo URLs, no-coordinate listings, concessions, duplicates, a scam-pattern listing, pet/laundry/parking variety). `seed:mock` runs it through the real pipeline in two phases so price-drop events, the missing chain, and "new today" states are produced by real machinery, not fixtures. |

### Seeded but disabled (investigate later)

- **Zillow / Apartments.com** — reference-only by design (`permissionStatus:
  reference_only_do_not_fetch`). Heavy anti-automation; not a sane foundation
  for a polite personal scraper. Use manually in a browser to cross-check.
- **Structure Properties / Gaetani** (AppFolio) — listing pages verified
  reachable 2026-07-01, but cards render client-side and the widget JSON
  endpoint returns 401 without the widget's session. Needs a Playwright-based
  `appfolio_js` adapter; one adapter would cover every AppFolio PM.
- **Trinity SF / Mosser / Brick+Timber / Lapham / Ballast** — recorded with
  best-known URLs and `needs_review`; not yet investigated. Notes say exactly
  what is unverified.

Every source records robots.txt status (re-checked weekly at run time),
permission notes, JS requirements, and whether it looks safe for personal
low-frequency fetching. These are **operational notes, not legal conclusions**.

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

### Duplicate detection
Union-find grouping on four signals: same normalized address + unit; same
title + price + neighborhood; shared photo identity **with matching unit
numbers** (units in one building share building photos — that's a building, not
a duplicate); same description hash unless unit numbers explicitly differ (PM
sites reuse per-building boilerplate). Photo identity only works within a
source (different sites host different copies) — cross-source photo matching
would need perceptual hashing later. Groups are recomputed db-wide after each
run; the detail view lists a listing's duplicate peers.

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
User-hidden / not-a-fit / rented-elsewhere listings are ineligible. One example
saved search is seeded by `seed:mock`. No alerts and no AI scoring yet — by
design; matching only uses concrete user preferences, never demographic or
protected-class proxies.

## UI

- **Map** (`/`) — MapLibre over OpenFreeMap Positron tiles. Clustered markers,
  color-coded by status (new today, price drop, verify carefully, saved,
  contacted, missing/stale), price labels at higher zooms, approximate
  locations ghosted, legend bottom-left. Right panel: photo cards with price
  (effective price when concessions parse), beds/baths/sqft, neighborhood,
  badges, source attribution, and last-checked time. Filters: text, price
  range, beds, laundry, neighborhoods, dogs/cats, suspicious-only, show-hidden,
  show-gone. Click a card or marker for the detail modal: gallery, badge row,
  user-status actions (saved/maybe/contacted/toured/applied/not-a-fit/hidden/
  suspicious), a **verify-before-acting callout**, suspicious-signal list,
  facts grid with raw values on hover, description, amenities, duplicate
  peers, full event history, source & contact block (source-level contact
  inherited unless the listing overrides), and the original-listing button.
- **Sources** (`/sources`) — per-source health: enabled state, robots/permission
  status, adapter type, JS/automation flags, listing counts, last-run summary
  (status, counts, pages, pagination ✓/✗/?, missing-tracking ran or not,
  warnings, errors) and run history.

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

`npm test` — ~100 tests, all offline (recorded fixtures in `fixtures/`):
parsers, hashing, neighborhoods (including the South-San-Francisco trap),
stale lifecycle + the failed/partial-run guard, dedupe signals + unit-number
guards, scam heuristics, saved-search matching, geocode caching + fallback
precision, both real adapters against recorded HTML, and end-to-end runner
tests on an in-memory DB (insert / price change / missing chain / reappear /
card-depth merge / cross-source duplicate / user statuses / contact
inheritance).

## Known limitations

- **Craigslist static cap**: each run sees the ~360 newest SF postings; older
  live postings beyond the cap are invisible, so CL missing-tracking is
  intentionally conservative (see lifecycle section). The JS search API could
  lift this later if an acceptable approach is verified.
- **Detail backlog**: a first Craigslist run finds ~330 listings but fetches
  only `maxDetailPagesPerRun` (50) detail pages; the rest are card-depth
  (title/price/hood, neighborhood-level coords) until later runs catch up.
  Raise the cap in `src/config/sources.ts` if you want faster convergence.
- Cross-source duplicate detection relies on address/title/description —
  photo matching across sources needs perceptual hashing (future).
- Effective-price math assumes a 12-month term when amortizing "N weeks/months
  free" (raw concession text always preserved).
- Single-user, no auth, local SQLite — by design for phase one.
- Scheduled runs aren't wired up; run manually or via cron/launchd on
  `npm run ingest -- --all`.

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

1. **AppFolio adapter via Playwright** (`structure_properties`, `gaetani_real_estate`) —
   one adapter unlocks many SF property managers.
2. **Scheduled ingestion + saved-search alerts** — cron/launchd wrapper around
   the runner, then a daily digest of new/changed matches using the existing
   deterministic matcher.
3. **Claude enrichment layer** — the long-term direction: match explanations,
   amenity extraction from messy descriptions, scam-signal reasoning, dedupe
   adjudication, and "questions to ask the landlord", operating on
   `rawPayload`/events via a Managed Agent or scheduled workflow.
