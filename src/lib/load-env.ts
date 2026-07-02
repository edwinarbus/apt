import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader for the standalone CLI scripts (`npm run enrich`,
 * `npm run vision`). The Next.js app already loads `.env.local` itself; the tsx
 * scripts don't, so they import this first.
 *
 * Reads `.env.local` then `.env` from the project root if present and sets any
 * `KEY=value` it finds — WITHOUT overriding variables already in the
 * environment (an explicit `export`, or Vercel's injected env, always wins).
 * No dependency; supports `KEY=value`, `#` comments, blank lines, and optional
 * surrounding quotes. Values are used verbatim (no interpolation).
 */
function loadFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return; // absent — that's fine
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (!key || val === "") continue;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const root = process.cwd();
for (const f of [".env.local", ".env"]) loadFile(path.join(root, f));
