import "@/lib/load-env";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Inspect and clean up Porter's managed-agent sessions.
 *
 *   npm run porter:sessions                    list recent sessions (read-only)
 *   npm run porter:sessions -- --archive-idle  archive every idle session (reversible)
 *   npm run porter:sessions -- --archive <id>  archive one session by id
 *
 * A self-hosted session sits in `idle` / requires_action when no worker is
 * running to execute its tools. Archiving is reversible (list with the API's
 * include_archived flag) — this never hard-deletes.
 */

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY found (needs Managed Agents beta access).");
    process.exit(1);
  }
  const agentId = process.env.APT_PORTER_AGENT_ID;
  const args = process.argv.slice(2);
  const archiveIdle = args.includes("--archive-idle");
  const archiveIdx = args.indexOf("--archive");
  const archiveOne = archiveIdx >= 0 ? args[archiveIdx + 1] : null;

  const client = new Anthropic();

  if (archiveOne) {
    const s = await client.beta.sessions.archive(archiveOne);
    console.log(`archived ${s.id} (status: ${s.status})`);
    return;
  }

  const params = agentId ? { agent_id: agentId } : {};
  const sessions = [];
  for await (const s of client.beta.sessions.list(params)) {
    sessions.push(s);
    if (sessions.length >= 25) break;
  }

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log(`Recent sessions${agentId ? ` for ${agentId}` : ""}:`);
  for (const s of sessions) {
    console.log(`  ${s.id}  status=${s.status}  created=${s.created_at}`);
  }

  if (archiveIdle) {
    const idle = sessions.filter((s) => s.status === "idle");
    if (idle.length === 0) {
      console.log("\nNo idle sessions to archive.");
      return;
    }
    console.log(`\nArchiving ${idle.length} idle session(s)…`);
    for (const s of idle) {
      const done = await client.beta.sessions.archive(s.id);
      console.log(`  archived ${done.id}`);
    }
  } else {
    console.log("\nRe-run with --archive-idle to archive the idle (stalled) ones.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
