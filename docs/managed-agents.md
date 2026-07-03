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

## Sketch (not wired up)

```ts
// scripts/scout-agent.ts (sketch) — create once, then schedule.
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({
  defaultHeaders: { "anthropic-beta": "managed-agents-2026-04-01" },
});

const agent = await anthropic.beta.agents.create({
  model: "claude-opus-4-8",
  systemPrompt: SCOUT_SYSTEM_PROMPT, // ranks new SF listings vs. saved criteria,
                                     // drafts (never sends) outreach, writes a digest
  tools: [{ type: "bash" }, { type: "web_search" }],
  // + an MCP server exposing the Apt DB read + "stage draft" write
});
// Then attach a scheduled deployment (cron) that opens a session against `agent.id`.
```

Wiring this up (the MCP bridge to Apt's DB, the scheduled deployment, and the
in-app "overnight inbox" + draft-review surface) is the natural next step — the
pipeline it would drive already exists.
