import type { SourceAdapter } from "./types";
import { craigslistAdapter } from "./craigslist";
import { rentSfNowAdapter } from "./rentsfnow";
import { rentBtAdapter } from "./rentbt";
import { mosserAdapter } from "./mosser";

/**
 * Adapter registry, keyed by a source's `adapterType`. Sources whose adapter
 * type is not registered (e.g. "none" for reference-only sources, or
 * "appfolio_js" pending a Playwright-based adapter) are skipped by the
 * runner with an explanatory message.
 */

const registry = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  registry.set(adapter.adapterType, adapter);
}

export function getAdapter(adapterType: string): SourceAdapter | null {
  return registry.get(adapterType) ?? null;
}

export function registeredAdapterTypes(): string[] {
  return [...registry.keys()];
}

registerAdapter(craigslistAdapter);
registerAdapter(rentSfNowAdapter);
registerAdapter(rentBtAdapter);
registerAdapter(mosserAdapter);
