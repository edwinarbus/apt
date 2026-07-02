import type { RobotsStatus } from "./types";
import type { TextFetcher } from "./fetcher";

/**
 * Minimal robots.txt evaluation, recorded on each source as operational
 * metadata (not legal advice). Uses standard longest-match semantics with
 * Allow winning ties. A missing robots.txt is recorded as "no_robots_txt".
 */

interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export function parseRobotsTxt(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow" || field === "allow") {
      lastWasAgent = false;
      if (current) {
        current.rules.push({ allow: field === "allow", path: value });
      }
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

export function isPathAllowed(
  groups: RobotsGroup[],
  userAgentToken: string,
  path: string,
): boolean {
  const token = userAgentToken.toLowerCase();
  const applicable =
    groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!applicable) return true;
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.rules) {
    if (!rule.path) continue; // "Disallow:" empty = allow all
    if (path.startsWith(rule.path)) {
      const length = rule.path.length;
      if (
        !best ||
        length > best.length ||
        (length === best.length && rule.allow && !best.allow)
      ) {
        best = { allow: rule.allow, length };
      }
    }
  }
  return best ? best.allow : true;
}

export interface RobotsCheckResult {
  status: RobotsStatus;
  notes: string;
}

export async function checkRobots(
  fetcher: TextFetcher,
  baseUrl: string,
  paths: string[],
  userAgentToken = "*",
): Promise<RobotsCheckResult> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { status: "error", notes: `invalid base url: ${baseUrl}` };
  }
  const res = await fetcher.fetchText(`${origin}/robots.txt`);
  if (res.status === 404) {
    return { status: "no_robots_txt", notes: "no robots.txt (404)" };
  }
  if (!res.ok) {
    return {
      status: "error",
      notes: `robots.txt fetch failed: ${res.error ?? res.status}`,
    };
  }
  const groups = parseRobotsTxt(res.text);
  const verdicts = paths.map((p) => ({
    path: p,
    allowed: isPathAllowed(groups, userAgentToken, p),
  }));
  const allowedCount = verdicts.filter((v) => v.allowed).length;
  const detail = verdicts
    .map((v) => `${v.path}: ${v.allowed ? "allowed" : "disallowed"}`)
    .join("; ");
  if (allowedCount === verdicts.length) {
    return { status: "allowed", notes: detail };
  }
  if (allowedCount === 0) {
    return { status: "disallowed", notes: detail };
  }
  return { status: "partial", notes: detail };
}
