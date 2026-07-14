import "@/lib/load-env";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Re-enable (unpause) Porter's nightly managed-agent deployment after it was
 * paused, so its 3am cron fires again. The mirror of `npm run porter:pause`.
 *
 * Pausing a scheduled deployment stops the cron from firing; unpausing resumes
 * it from the NEXT occurrence — missed nights are not backfilled. This only
 * flips the schedule back on; it does not run a pass right now. Pass `--now`
 * (or use `npm run porter:run`) to also trigger one immediately.
 *
 * Reminder: Porter's environment is self-hosted, so a resumed nightly session
 * has nowhere to execute its bash/file tools unless a worker is running. Keep
 * `npm run porter:worker` up (or install the keepalive daemon with
 * `npm run worker:install`), or the run will just sit idle.
 *
 *   npm run porter:resume                 unpause; print status + next runs
 *   npm run porter:resume -- --now        unpause, then trigger a run now
 *   npm run porter:resume -- depl_xxx     target a specific deployment id
 *
 * Resolves the deployment from an explicit `depl_…` arg or
 * APT_PORTER_DEPLOYMENT_ID, else the first deployment for APT_PORTER_AGENT_ID.
 */

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY found (needs Managed Agents beta access).");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const runNow = args.includes("--now");
  const explicitId =
    args.find((a) => a.startsWith("depl_")) ?? process.env.APT_PORTER_DEPLOYMENT_ID ?? null;
  const agentId = process.env.APT_PORTER_AGENT_ID;

  const client = new Anthropic();

  // Resolve the deployment: an explicit id wins; otherwise find it by agent —
  // same discovery `npm run porter:run` uses.
  let deployment;
  if (explicitId) {
    deployment = await client.beta.deployments.retrieve(explicitId);
  } else {
    if (!agentId) {
      console.error(
        "Set APT_PORTER_AGENT_ID (or pass a depl_… id) so I know which deployment to resume.\n" +
          "Run `npm run porter:deploy -- --deploy` first if Porter was never provisioned.",
      );
      process.exit(1);
    }
    const deployments = [];
    for await (const d of client.beta.deployments.list({ agent_id: agentId })) {
      deployments.push(d);
    }
    if (deployments.length === 0) {
      console.error(
        "No deployments found for this agent. Run `npm run porter:deploy -- --deploy` first.",
      );
      process.exit(1);
    }
    deployment = deployments[0];
  }

  console.log(`Deployment ${deployment.id} (${deployment.name}) — status: ${deployment.status}`);
  const reason = deployment.paused_reason;
  if (reason) {
    // 'manual' = someone hit pause; 'error' = auto-paused, and the nested
    // error.type says which failure (e.g. a missing environment) — worth
    // surfacing so a resume that'll just re-trip isn't done blind.
    const detail = reason.type === "error" ? `error — ${reason.error?.type ?? "unknown"}` : reason.type;
    console.log(`  paused reason: ${detail}`);
  }

  if (!String(deployment.status).toLowerCase().includes("paus")) {
    console.log("Already active — nothing to unpause.");
  } else {
    deployment = await client.beta.deployments.unpause(deployment.id);
    console.log(`Resumed → status: ${deployment.status}`);
  }

  const upcoming = deployment.schedule?.upcoming_runs_at ?? [];
  if (upcoming.length) {
    console.log(`Next runs: ${upcoming.slice(0, 3).join(", ")}`);
  } else {
    console.log("No upcoming runs listed — check the deployment's schedule.");
  }

  if (runNow) {
    console.log("\n--now: triggering a run immediately…");
    const run = await client.beta.deployments.run(deployment.id);
    console.log(`Run started: ${run.id}  (session: ${run.session_id ?? "pending"})`);
  }

  console.log(
    "\nKeep a worker running so the nightly session can execute its tools:\n" +
      "  npm run porter:worker\n" +
      "Watch runs with: npm run porter:sessions",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
