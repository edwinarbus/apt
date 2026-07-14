import "@/lib/load-env";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Pause Porter's nightly managed-agent deployment so its 3am cron stops firing
 * — e.g. while you're away and don't want new nightly passes, or during
 * maintenance. The mirror of `npm run porter:resume`, which unpauses it again.
 *
 * Reversible: pausing only stops the schedule; no in-flight session is killed,
 * and resuming picks up from the next occurrence (missed nights aren't
 * backfilled). To stop permanently, archive the deployment instead.
 *
 *   npm run porter:pause                  pause; print status
 *   npm run porter:pause -- depl_xxx      target a specific deployment id
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
        "Set APT_PORTER_AGENT_ID (or pass a depl_… id) so I know which deployment to pause.\n" +
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

  if (String(deployment.status).toLowerCase().includes("paus")) {
    console.log("Already paused — nothing to do. (npm run porter:resume to re-enable.)");
    return;
  }

  deployment = await client.beta.deployments.pause(deployment.id);
  console.log(`Paused → status: ${deployment.status}`);
  console.log("Re-enable any time with: npm run porter:resume");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
