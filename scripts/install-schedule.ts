import fs from "node:fs";
import path from "node:path";

/**
 * Generate a macOS launchd plist that runs `npm run daily` on a schedule.
 * This writes the plist to ./data and prints the two commands to install it —
 * it does NOT touch the system itself (installing a launchd agent is a
 * user-owned action). On Linux, use the printed cron line instead.
 *
 *   npm run schedule:install            overnight at 03:00
 *   npm run schedule:install -- --hour 7 --minute 30
 */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

const hour = arg("hour", 3);
const minute = arg("minute", 0);
const cwd = process.cwd();
const label = "us.edwinarb.apt.daily";
const npmPath = process.env.npm_node_execpath
  ? path.dirname(process.env.npm_node_execpath)
  : "/usr/local/bin";

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
    <string>cd ${cwd} &amp;&amp; npm run daily &gt;&gt; ${cwd}/data/daily.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardErrorPath</key>
  <string>${cwd}/data/daily.err.log</string>
  <key>StandardOutPath</key>
  <string>${cwd}/data/daily.out.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${npmPath}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;

const outDir = path.join(cwd, "data");
fs.mkdirSync(outDir, { recursive: true });
const plistPath = path.join(outDir, `${label}.plist`);
fs.writeFileSync(plistPath, plist);

const hh = String(hour).padStart(2, "0");
const mm = String(minute).padStart(2, "0");

console.log(`Wrote launchd plist: ${plistPath}`);
console.log(`Scheduled time: daily at ${hh}:${mm}\n`);
console.log("To install on macOS (you run these — the tool won't touch the system):");
console.log(`  cp ${plistPath} ~/Library/LaunchAgents/${label}.plist`);
console.log(`  launchctl load ~/Library/LaunchAgents/${label}.plist`);
console.log(`To remove:`);
console.log(`  launchctl unload ~/Library/LaunchAgents/${label}.plist\n`);
console.log("Or, on Linux, add this cron line (crontab -e):");
console.log(`  ${mm} ${hh} * * *  cd ${cwd} && npm run daily >> ${cwd}/data/daily.log 2>&1`);
