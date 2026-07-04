import "@/lib/load-env";
import fs from "node:fs";
import path from "node:path";

/**
 * Generate a macOS launchd plist that keeps Porter's self-hosted worker
 * (`npm run porter:worker`) running continuously, so the overnight managed-agent
 * session always has somewhere to execute its tools. Unlike the Scout SCHEDULE
 * (a periodic `npm run daily`), the worker is a long-lived daemon: it long-polls
 * Anthropic's queue and runs the agent's bash/file tools locally in this repo.
 *
 * KeepAlive restarts it if it exits; RunAtLoad starts it at login. If the Mac is
 * asleep at 3am, the nightly session simply waits in `requires_action` until the
 * worker wakes and claims it — the work still runs, just later.
 *
 * This writes the plist to ./data and prints the install commands; it does NOT
 * touch the system (loading a launchd agent is a user-owned action).
 *
 *   npm run worker:install
 *
 * Prereqs (the worker reads these from .env.local via @/lib/load-env):
 *   • ANTHROPIC_ENVIRONMENT_KEY  — generate on the environment's page in the
 *     Anthropic Console (format sk-ant-oat01-…) and add it to .env.local
 *   • APT_PORTER_ENV_ID          — already set in .env.local
 *
 * To have Porter's nightly `npm run daily` update the DEPLOYED app (Turso) rather
 * than the local SQLite file, install with the production creds present — they're
 * baked into the plist's env (./data is gitignored):
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run worker:install
 */

const cwd = process.cwd();
const label = "us.edwinarb.apt.porter-worker";
const npmPath = process.env.npm_node_execpath
  ? path.dirname(process.env.npm_node_execpath)
  : "/usr/local/bin";

// Bake in creds only if present at install time (./data is gitignored). The
// worker also reads .env.local itself, so ANTHROPIC_ENVIRONMENT_KEY can live
// there instead; TURSO_* must be passed here to target the deployed DB, since
// .env.local keeps them commented out so local dev uses the local file.
const passthrough = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_ENVIRONMENT_KEY",
  "ANTHROPIC_ENVIRONMENT_ID",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
] as const;
const envEntries: Array<[string, string]> = [
  ["PATH", `${npmPath}:/usr/local/bin:/usr/bin:/bin`],
  ...passthrough
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k] as string] as [string, string]),
];
const targetsProd = Boolean(process.env.TURSO_DATABASE_URL);

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const envXml = envEntries
  .map(([k, v]) => `    <key>${k}</key>\n    <string>${xmlEscape(v)}</string>`)
  .join("\n");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>cd ${xmlEscape(cwd)} &amp;&amp; exec npm run porter:worker</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(cwd)}/data/porter-worker.err.log</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(cwd)}/data/porter-worker.out.log</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
</dict>
</plist>
`;

const outDir = path.join(cwd, "data");
fs.mkdirSync(outDir, { recursive: true });
const plistPath = path.join(outDir, `${label}.plist`);
fs.writeFileSync(plistPath, plist);

const hasEnvKey = Boolean(process.env.ANTHROPIC_ENVIRONMENT_KEY);

console.log(`Wrote launchd plist: ${plistPath}`);
console.log(`Daemon: keeps \`npm run porter:worker\` running (RunAtLoad + KeepAlive)`);
console.log(`Target DB for Porter's daily run: ${targetsProd ? "Turso (production)" : "local SQLite (data/apt.db)"}`);
if (!hasEnvKey) {
  console.log(
    "\n⚠  ANTHROPIC_ENVIRONMENT_KEY is not set. The worker cannot authenticate without it.\n" +
      "   Generate it on the environment's page in the Anthropic Console (format\n" +
      "   sk-ant-oat01-…) and add it to .env.local, THEN load the daemon below.",
  );
}
console.log("\nTo install on macOS (you run these — the tool won't touch the system):");
console.log(`  cp ${plistPath} ~/Library/LaunchAgents/${label}.plist`);
console.log(`  launchctl load ~/Library/LaunchAgents/${label}.plist`);
console.log(`To stop / remove:`);
console.log(`  launchctl unload ~/Library/LaunchAgents/${label}.plist`);
console.log(`\nTail its log:  tail -f ${cwd}/data/porter-worker.out.log`);
