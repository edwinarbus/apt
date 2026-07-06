# Apt

A personal, non-commercial San Francisco apartment scout. It ingests real listings from
several SF rental sources onto one live map, then layers Claude on top of the raw data —
natural-language search, structured enrichment, photo understanding, a nightly agent that
drafts applications, and a memory of what you don't want.

The original listing is always the source of truth. Nothing here republishes data, contacts
anyone automatically, or makes a definitive fraud/scam claim — suspicious signals are always
surfaced as "verify carefully," never as an accusation.

## What it does

**Live SF map.** MapLibre GL, dark tactical styling, masked to show only San Francisco.
Listings render as clustered price pins; clicking a neighborhood — or naming one in a search
("apartments in the Mission") — reveals it with real satellite imagery, live terrain relief,
and a highlighted boundary, with 3D buildings extruding once you're zoomed in close.

**Natural-language search (Claude Sonnet 5).** Type "sunny 1BR near a park in
the Marina with in-unit laundry and hardwood floors" and Claude ranks every candidate,
combining its own SF geography knowledge with each listing's structured fields, description,
and vision-extracted photo features. Reasoning streams live via adaptive thinking.

**Structured enrichment & risk scoring (Claude Haiku).** Turns each listing's scraped text
into clean facts — amenities, laundry/parking type, pet policy, lease terms — and a neutral
risk read: concrete, observable signals (rent far below what the listing itself implies,
a request to wire a deposit before viewing, no address given). Also produces a few renter-useful 
notes: what to verify before contacting and questions worth asking the landlord. Grounded 
strictly in what the listing itself says; nothing is invented.

**Photo vision (Claude Haiku).** Reads each listing's photos into searchable visual features
("hardwood floors," "bay windows," "renovated kitchen") and a condition read, so search can
match on what a listing *looks like*, not just what it claims.

**Porter — a managed agent (Claude Managed Agents).** An overnight agent that runs nightly in 
its own sandboxed environment, pulls new listings across every saved search, ranks them, and 
drafts a complete rental application for every new match. An auto-send feature can be toggled on so the
agent automatically submits the application, or toggled off so the user can manually review each match
and email a copy themselves.

**Preference memory (Claude Memory Store).** Thumbs-down a listing and Apt writes its
basic characteristics — price band, bedrooms, neighborhood, parking, laundry, flooring, pets —
to a durable memory store. Once a characteristic (say, wall-to-wall carpet) shows up across
several dislikes, Porter's shortlist quietly steers toward listings sharing *fewer* of your
recurring aversions. It's deliberately light: one dislike changes nothing, and it never
reasons about people or neighborhoods — only the unit.

**Everything else you'd expect:** cross-source duplicate detection, price-change history,
stale/removed-listing tracking, a saved-search digest, a source-health dashboard (robots.txt
compliance, verification status, crawl cadence), and a listing detail view with an
autoplaying photo carousel, save/not-a-fit verdicts, and risk signals.

## Claude API surface

Claude shows up in five different shapes across the app, each picked for what the task needs:

| Feature | Model | API surface |
|---|---|---|
| Natural-language search | Sonnet 5 | Streaming `messages.create`, adaptive thinking (`display: "summarized"`) for live reasoning, `output_config.effort: "low"` for interactive speed, prompt caching (`cache_control: ephemeral`) on the system prompt |
| Listing enrichment | Haiku 4.5 | `messages.create` with a schema-described prompt, validated against a Zod schema, prompt caching on the system prompt, one automatic retry on a malformed reply |
| Photo vision | Haiku 4.5 | Multi-image `messages.create`, same structured-extraction + caching pattern as enrichment |
| Porter (overnight agent) | Sonnet 5 | **Managed Agents** — a persisted `Agent` (model + system prompt + tools) run inside a **self-hosted Environment**, driven nightly by a **scheduled Deployment** (cron). A local worker process (`porter:worker`) polls Anthropic's queue and executes the agent's bash/file tool calls against this repo's own `npm run daily` pipeline and local SQLite DB — nothing about your data leaves your machine except the model's reasoning tokens. |
| Preference memory | — | **Memory Store** — a workspace-scoped store of small text documents (one per disliked listing), read back deterministically by the app's own light curation logic and available for Porter's session to consult |

Every model call handles `stop_reason: "refusal"` explicitly and never silently drops a
malformed response: enrichment and vision each retry once with a firmer instruction before
giving up, and search distinguishes a truncated reply (`stop_reason: "max_tokens"`) from an
unparseable one so the UI can say which actually happened, instead of a generic failure.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind CSS v4
- **SQLite** (better-sqlite3) + **Drizzle ORM** — one portable file at `data/apt.db`
- **MapLibre GL** with OpenFreeMap tiles (no map API key needed) + a terrain/satellite proxy
- **cheerio** for HTML parsing; a polite HTTP fetcher plus a Playwright fetcher (headless
  Chromium) behind one shared interface, for JS-rendered sources
- **`@anthropic-ai/sdk`** — powers search, enrichment, vision, Porter, and preference memory
- **Vitest** for tests (all offline, no network/API calls), **tsx** for CLI scripts

## Quick start

```bash
npm install
npx playwright install chromium   # only needed for JS-rendered sources
npm run seed:sources              # upsert the SF source registry
npm run ingest -- --all           # pull real listings from every enabled source
npm run dev                       # → http://localhost:3000
```

The app runs on real data only — there's no mock/demo mode. Everything below is optional and
additive on top of that base pipeline.

```bash
npm run enrich                    # structured facts + risk notes (Haiku)
npm run vision                    # photo feature extraction (Haiku)
npm run daily                     # the full nightly loop: ingest + enrich + vision + digest
npm run porter:deploy -- --deploy # provision Porter (agent, environment, memory store, schedule)
npm run porter:worker             # keep running so Porter's nightly session has tools to execute
```

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Search, enrichment, vision, Porter | Required — set in your deployment environment (e.g. Vercel project env vars) |
| `APT_SEARCH_MODEL` | — | Override the search model (default `claude-sonnet-5`) |
| `APT_ENRICH_MODEL` | — | Override the enrichment model (default `claude-haiku-4-5`) |
| `APT_VISION_MODEL` | — | Override the vision model (default `claude-haiku-4-5`) |
| `APT_PORTER_AGENT_ID` / `APT_PORTER_ENV_ID` | Porter | Printed by `porter:deploy`; reuse across runs instead of re-provisioning |
| `APT_MEMORY_STORE_ID` | Porter + preference memory | Printed by `porter:deploy`; the app writes dislikes here |
| `ANTHROPIC_ENVIRONMENT_KEY` / `ANTHROPIC_ENVIRONMENT_ID` | Porter's local worker | Generated in the Anthropic Console for the self-hosted environment |
| `APT_DB_PATH` | — | Override the SQLite file path (default `data/apt.db`) |

## Project layout

```
src/
  adapters/     one file per rental source (Craigslist, RentSFNow, Mosser, Brick + Timber, …)
  core/         deterministic pipeline: normalize, dedupe, geocode, scam heuristics, matching
  search/       Claude search client + prompt + streaming NDJSON route
  enrich/       Claude enrichment client + Zod schema
  vision/       Claude vision client + Zod schema
  memory/       dislike characteristics + light curation + the Claude Memory Store client
  db/           Drizzle schema + client (SQLite)
  components/   the map, search bar, results rail, listing detail, Porter panel
scripts/        CLI entry points (ingest, enrich, vision, daily, porter:deploy, …)
```

## Scope & constraints

This is a single-person tool, not a product: no accounts, no multi-tenant data, no public
API. It fetches sources politely and at low frequency, respects `robots.txt`, never infers
protected-class or demographic information about anyone, and never sends a message on your
behalf — Porter drafts, you send.
