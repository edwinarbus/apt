import "@/lib/load-env";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Manually trigger Porter's nightly deployment right now, instead of waiting
 * for its 3am cron. Requires the worker (`npm run porter:worker`, or the
 * keepalive daemon from `npm run worker:install`) to be running to actually
 * execute the resulting session's tools.
 *
 *   npm run porter:run
 */

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY found (needs Managed Agents beta access).");
    process.exit(1);
  }
  const agentId = process.env.APT_PORTER_AGENT_ID;
  if (!agentId) {
    console.error("APT_PORTER_AGENT_ID not set — run `npm run porter:deploy -- --deploy` first.");
    process.exit(1);
  }

  const client = new Anthropic();
  const deployments = [];
  for await (const d of client.beta.deployments.list({ agent_id: agentId })) {
    deployments.push(d);
  }
  if (deployments.length === 0) {
    console.error("No deployments found for this agent. Run `npm run porter:deploy -- --deploy` first.");
    process.exit(1);
  }
  const deployment = deployments[0];
  console.log(`Triggering deployment ${deployment.id} (${deployment.name})…`);
  const run = await client.beta.deployments.run(deployment.id);
  console.log(`Run started: ${run.id}`);
  console.log(`  session: ${run.session_id ?? "(pending)"}`);
  console.log("\nWatch it: npm run porter:sessions");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
