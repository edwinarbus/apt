import "@/lib/load-env";
import Anthropic from "@anthropic-ai/sdk";
import { EnvironmentWorker } from "@anthropic-ai/sdk/helpers/beta/environments";

/**
 * The local worker for Autopilot's self-hosted environment. Keep this running
 * (e.g. under launchd) so the overnight managed-agent session has somewhere to
 * execute its tools: it long-polls Anthropic's work queue and runs the agent's
 * bash/file tool calls HERE, in this repo, against your local data/apt.db.
 * Connectivity is outbound-only — Anthropic never dials into your machine.
 *
 * Prereqs (from `npm run autopilot:deploy -- --deploy`):
 *   • APT_AUTOPILOT_ENV_ID (or ANTHROPIC_ENVIRONMENT_ID) — the self-hosted env id
 *   • ANTHROPIC_ENVIRONMENT_KEY — the environment key (generated in the Console
 *     on the environment's page; format sk-ant-oat01-…)
 *
 *   npm run autopilot:worker
 */

async function main() {
  const environmentKey = process.env.ANTHROPIC_ENVIRONMENT_KEY;
  const environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID ?? process.env.APT_AUTOPILOT_ENV_ID;

  if (!environmentKey || !environmentId) {
    console.error(
      "Missing env. The self-hosted worker needs:\n" +
        "  ANTHROPIC_ENVIRONMENT_KEY  (generate on the environment's page in the Console)\n" +
        "  APT_AUTOPILOT_ENV_ID           (printed by `npm run autopilot:deploy -- --deploy`)\n",
    );
    process.exit(1);
  }

  const client = new Anthropic({ authToken: environmentKey });
  const ctrl = new AbortController();
  process.once("SIGTERM", () => ctrl.abort());
  process.once("SIGINT", () => ctrl.abort());

  console.log(
    `Autopilot worker polling ${environmentId}\n` +
      `  workdir: ${process.cwd()}\n` +
      "  tools run locally against your data/apt.db. Ctrl-C to stop.\n",
  );

  await new EnvironmentWorker({
    client,
    environmentId,
    environmentKey,
    workdir: process.cwd(),
    signal: ctrl.signal,
  }).run();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
