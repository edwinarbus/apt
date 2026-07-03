# Apt × Claude Managed Agents

How Apt could use [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)
to run itself overnight — find new apartments, rank them against your criteria,
notify you, and *draft* (never auto-send) outreach — with the guardrails this
project already commits to.

## What Managed Agents gives us

Instead of building our own agent loop, sandbox, and tool runtime, Managed Agents
provides a **managed cloud harness** (beta; header `managed-agents-2026-04-01`).
The pieces relevant to Apt:

- **Agent** — a saved config: model (`claude-haiku-4-5` for Apt's cheap
  enrichment/vision, `claude-opus-4-8` for the nightly judgment), system prompt,
  tools, MCP servers. Create once, reference by ID.
- **Environment** — where sessions run: an Anthropic-managed sandbox with network
  access and pre-installed packages (or a self-hosted sandbox we control — useful
  since Apt's SQLite DB and API key stay local).
- **Session** — a running instance doing one task; **stateful**, resumes cleanly
  after pauses, keeps a filesystem + history.
- **Scheduled deployments (cron)** — recurring runs. This is the overnight hook.
- **Built-in tools** — Bash, file ops, **web search + fetch**, and **MCP servers**
  to reach our own data.

## The overnight "Apt Scout" agent

Apt already has the whole pipeline as scripts: `ingest → geocode → enrich →
vision → digest` (`npm run daily`). A Managed Agent doesn't replace those — it
*orchestrates* them with judgment and reports like a research assistant.

```
Scheduled deployment (cron, ~3am daily)
  └─ Session: "Apt Scout — nightly"  (self-hosted sandbox with repo + DB + key)
       1. Bash: `npm run ingest -- --all`   (pull every enabled source)
       2. Bash: `npm run enrich` / `npm run vision`   (new/changed only)
       3. Query the DB (MCP or bash) for listings that are NEW since last run
          AND match the user's saved criteria (beds, price, neighborhoods,
          must-haves), scored by the existing search ranker.
       4. Judge the shortlist: dedupe, drop likely-stale/likely-scam, write a
          2–3 line "why this one" per keeper (Opus).
       5. NOTIFY: write a digest (the existing `digest.ts` already builds one) and
          deliver it — email/Slack/push via an MCP server, or just a file the app
          surfaces as an "overnight" inbox.
       6. For keepers the user has pre-marked "interested": DRAFT a personalized
          outreach message to the lister (using the listing's real contact) and
          stage it for review. It does NOT send.
```

Because sessions are **stateful**, the agent remembers what it already surfaced
(no repeat pings), and "dreaming" (research preview) could learn the user's
accept/reject pattern over time to tune the shortlist.

## The email question — draft, don't send

The prompt asked about "sending an email to the lister." Apt has a **standing
constraint: no automated outreach.** Auto-emailing listers at 3am is exactly what
that rule exists to prevent (it's how scrapers become spam, and it acts on the
user's behalf without a per-message decision).

So the agent **drafts** outreach and stops:

- It composes a short, specific message (grounded in the listing's real details)
  and saves it as a *pending* draft with the lister's contact prefilled.
- The user reviews each draft in the app and sends it themselves — or approves it
  explicitly. Per Apt's action rules, sending a message is a per-action,
  per-session human decision; the agent never crosses that line.

This keeps the useful part (a ready-to-send, well-researched message) without the
part that's rude, risky, and against the project's principles.

## Why Managed Agents vs. a plain cron script

We *could* just `cron` the existing `npm run daily`. Managed Agents earns its
place only where **judgment across a fuzzy, changing set** helps:

- ranking + de-duping + scam-screening new inventory against soft criteria,
- writing the human-readable "why", and the outreach drafts,
- adapting as sources break or the user's taste shifts.

If a run is purely mechanical, keep it a cron script. Reach for the agent for the
"too complex for a script, not worth waking a human at 3am" middle — which is
precisely the nightly-shortlist problem.

## Not a fit / cautions

- **Data retention**: Managed Agents sessions are stateful and store history
  server-side, so they're **not ZDR/HIPAA-eligible**. Fine for public listing
  data; don't put anything sensitive in the session.
- **Beta**: endpoints need the beta header; MCP tunnels + dreaming are a narrower
  research preview (request access).
- **Cost/scale**: overnight Opus judgment over a shortlist is cheap; don't have it
  re-vision every listing every night — reuse Apt's "new/changed only" gating.

## How it's wired up

This is implemented, using a **self-hosted sandbox** — the honest fit, since
Apt's data (SQLite + API key) is local. The agent loop (the judgment) runs on
Anthropic's orchestration layer; tool execution (bash/files) runs in a container
*you* control via a local worker, so the agent runs the real pipeline against
your `data/apt.db` and stages drafts on your machine. Nothing leaves your box.

Two layers, both runnable:

**1. The overnight pickup (works today, no cloud needed)** — `npm run daily`
now runs the full pipeline (`ingest → enrich → vision → digest`, AI passes
cost-capped and skipped without a key). Schedule it overnight:

```
npm run schedule:install        # writes a launchd plist for 3:00am; you load it
```

**2. The managed agent (the cloud brain)** — three scripts:

```
npm run scout:deploy               # dry run: prints the plan, creates nothing
npm run scout:deploy -- --deploy   # creates env (self-hosted) + agent + nightly deployment
npm run scout:worker               # keep running so the 3am session can execute its tools
```

- `scripts/scout-agent.ts` — creates a self-hosted environment, the **Apt Scout**
  agent (`claude-opus-4-8`, `agent_toolset_20260401`, the scout system prompt
  with the no-auto-send rule baked in), and a **scheduled deployment** firing
  `0 3 * * *` `America/Los_Angeles`. Create-once: reuse via `APT_SCOUT_ENV_ID` /
  `APT_SCOUT_AGENT_ID`.
- `scripts/scout-worker.ts` — the local `EnvironmentWorker` that long-polls
  Anthropic and executes the agent's tool calls in this repo (outbound-only).

Each night the deployment opens a session; the agent runs `npm run daily`,
queries the DB for what's new since yesterday, ranks it against saved criteria,
writes a report under `data/reports/`, and **stages** (never sends) outreach
drafts for listings you've marked interested.

Still worth building next: the in-app "overnight inbox" + draft-review surface
so the staged reports and drafts show up in the UI.
