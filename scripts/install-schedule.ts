import fs from "node:fs";
import path from "node:path";

/**
 * Generate a macOS launchd plist (and matching cron line) that runs
 * `npm run daily` — ingest → enrich → vision → saved-search digest, i.e. the
 * Scout/Porter "check for new matches" pass — on a repeating schedule.
 *
 * Defaults to EVERY 4 HOURS. This writes the plist to ./data and prints the
 * commands to install it; it does NOT touch the system itself (installing a
 * launchd agent is a user-owned action). On Linux, use the printed cron line.
 *
 *   npm run schedule:install                     every 4 hours, on the hour
 *   npm run schedule:install -- --every 6        every 6 hours
 *   npm run schedule:install -- --minute 30      every 4 hours at :30
 *   npm run schedule:install -- --at 3           once daily at 03:00
 *
 * To make the scheduled run update the DEPLOYED app (Turso) rather than the
 * local SQLite file, provide the production creds when installing — they're
 * baked into the plist's EnvironmentVariables (./data is gitignored):
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run schedule:install
 */

function numFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

const dailyAt = numFlag("at", -1); // -1 = interval mode (default)
const everyHours = Math.min(24, Math.max(1, numFlag("every", 4)));
const minute = Math.min(59, Math.max(0, numFlag("minute", 0)));
const interval = dailyAt < 0;
const hours = interval
  ? Array.from({ length: Math.ceil(24 / everyHours) }, (_, i) => i * everyHours).filter((h) => h < 24)
  : [Math.min(23, Math.max(0, dailyAt))];

const cwd = process.cwd();
const label = "us.edwinarb.apt.scout";
const npmPath = process.env.npm_node_execpath
  ? path.dirname(process.env.npm_node_execpath)
  : "/usr/local/bin";

// Bake in production creds only if they're present at install time, so the
// scheduled run can target Turso (the deployed app) instead of the local file.
// Absent → the job runs against the local SQLite DB. Never hard-coded here.
const passthrough = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
const envEntries: Array<[string, string]> = [
  ["PATH", `${npmPath}:/usr/local/bin:/usr/bin:/bin`],
  ...passthrough
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k] as string] as [string, string]),
];
const targetsProd = Boolean(process.env.TURSO_DATABASE_URL);

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const calendarEntries = hours
  .map(
    (h) =>
      `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${minute}</integer></dict>`,
  )
  .join("\n");
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
    <string>cd ${xmlEscape(cwd)} &amp;&amp; npm run daily &gt;&gt; ${xmlEscape(cwd)}/data/scout.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${calendarEntries}
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(cwd)}/data/scout.err.log</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(cwd)}/data/scout.out.log</string>
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

const mm = String(minute).padStart(2, "0");
const cadence = interval
  ? `every ${everyHours}h at :${mm} (hours ${hours.join(", ")})`
  : `daily at ${String(hours[0]).padStart(2, "0")}:${mm}`;

console.log(`Wrote launchd plist: ${plistPath}`);
console.log(`Schedule: ${cadence}`);
console.log(`Target DB: ${targetsProd ? "Turso (production) — creds baked in" : "local SQLite (data/apt.db)"}\n`);
console.log("To install on macOS (you run these — the tool won't touch the system):");
console.log(`  cp ${plistPath} ~/Library/LaunchAgents/${label}.plist`);
console.log(`  launchctl load ~/Library/LaunchAgents/${label}.plist`);
console.log(`To remove:`);
console.log(`  launchctl unload ~/Library/LaunchAgents/${label}.plist\n`);
const cronHours = interval ? `*/${everyHours}` : String(hours[0]);
console.log("Or, on Linux, add this cron line (crontab -e):");
console.log(`  ${mm} ${cronHours} * * *  cd ${cwd} && npm run daily >> ${cwd}/data/scout.log 2>&1`);
if (!targetsProd) {
  console.log(
    "\nNote: this run updates the LOCAL database. To refresh the deployed app, re-run with\n" +
      "  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run schedule:install",
  );
}
