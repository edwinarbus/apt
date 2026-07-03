/**
 * The Claude Memory Store (Managed Agents, beta) that persists the user's
 * disliked apartments across sessions. Each thumbs-down writes one small memory
 * document; Porter's nightly session mounts this store and reads it to curate
 * the shortlist (see scripts/porter-agent.ts).
 *
 * Everything here is BEST-EFFORT. The app's own curation runs off the local
 * `not_a_fit` listings, so a missing API key, no beta access, or an offline
 * network never breaks the thumbs-down — the managed-agents copy just doesn't
 * get updated. We lazily import the SDK (importing this module never needs a
 * key) and resolve the store id from APT_MEMORY_STORE_ID, creating one only if
 * asked to and none is configured.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { characteristicTags, dislikeMemoryDoc, type DislikeFacts } from "./characteristics";

export const DISLIKE_PREFIX = "/dislikes/";
export const STORE_NAME = "apt-disliked-apartments";
export const STORE_DESCRIPTION =
  "Apartments the user thumbs-downed in Apt, with their basic characteristics. Personal-preference signals about units (price band, beds, neighborhood, parking, laundry, flooring, pets) — never about people. Use to steer the shortlist away from characteristics that RECUR across several disliked apartments; weigh lightly and never over-index on a single dislike.";

/** Canonical memory path for one listing's dislike record. */
export function dislikePath(listingId: string): string {
  return `${DISLIKE_PREFIX}${listingId}.md`;
}

export interface MemoryOutcome {
  ok: boolean;
  /** true when the write was skipped (no key / beta / store) rather than failed */
  skipped: boolean;
  error: string | null;
}

const skipped = (error: string | null): MemoryOutcome => ({ ok: false, skipped: true, error });

/**
 * Thin wrapper over `client.beta.memoryStores`. Constructed per request but
 * cheap: it only touches the network when a dislike is actually recorded, and
 * caches the resolved store id and client promise on the instance.
 */
export class DislikeMemoryStore {
  private clientPromise: Promise<Anthropic> | null = null;
  private storeIdPromise: Promise<string | null> | null = null;
  private readonly allowCreate: boolean;

  constructor(opts: { allowCreate?: boolean } = {}) {
    // Only provisioning scripts should create a store; the request path just
    // uses the one named by APT_MEMORY_STORE_ID (or quietly does nothing).
    this.allowCreate = opts.allowCreate ?? false;
  }

  private async getClient(): Promise<Anthropic | null> {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
    if (!this.clientPromise) {
      this.clientPromise = import("@anthropic-ai/sdk").then(({ default: A }) => new A());
    }
    try {
      const client = await this.clientPromise;
      // Feature-detect the beta surface so an older SDK degrades gracefully.
      return client.beta?.memoryStores ? client : null;
    } catch {
      return null;
    }
  }

  /** Resolve (or, when allowed, create) the store id. Returns null if unavailable. */
  async storeId(): Promise<string | null> {
    if (!this.storeIdPromise) {
      this.storeIdPromise = (async () => {
        const configured = process.env.APT_MEMORY_STORE_ID?.trim();
        if (configured) return configured;
        if (!this.allowCreate) return null;
        const client = await this.getClient();
        if (!client) return null;
        const store = await client.beta.memoryStores.create({
          name: STORE_NAME,
          description: STORE_DESCRIPTION,
        });
        return store.id;
      })();
    }
    try {
      return await this.storeIdPromise;
    } catch {
      return null;
    }
  }

  /** Persist a disliked listing as one memory document. Idempotent on the path. */
  async remember(listingId: string, facts: DislikeFacts): Promise<MemoryOutcome> {
    const client = await this.getClient();
    if (!client) return skipped("no Anthropic client (key/beta unavailable)");
    const storeId = await this.storeId();
    if (!storeId) return skipped("no memory store configured (set APT_MEMORY_STORE_ID)");

    const content = dislikeMemoryDoc(facts, characteristicTags(facts));
    const path = dislikePath(listingId);
    try {
      await client.beta.memoryStores.memories.create(storeId, { path, content });
      return { ok: true, skipped: false, error: null };
    } catch (err) {
      // Path already exists → the dislike is already remembered; that's fine.
      if (isConflict(err)) return { ok: true, skipped: false, error: null };
      return { ok: false, skipped: false, error: msg(err) };
    }
  }

  /** Remove a listing's dislike record (best-effort; used when un-thumbs-downing). */
  async forget(listingId: string): Promise<MemoryOutcome> {
    const client = await this.getClient();
    if (!client) return skipped("no Anthropic client (key/beta unavailable)");
    const storeId = await this.storeId();
    if (!storeId) return skipped("no memory store configured (set APT_MEMORY_STORE_ID)");

    const path = dislikePath(listingId);
    try {
      for await (const m of client.beta.memoryStores.memories.list(storeId, { path_prefix: path })) {
        if (m.type === "memory" && m.path === path) {
          await client.beta.memoryStores.memories.delete(m.id, { memory_store_id: storeId });
        }
      }
      return { ok: true, skipped: false, error: null };
    } catch (err) {
      return { ok: false, skipped: false, error: msg(err) };
    }
  }
}

function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err != null &&
    "status" in err &&
    (err as { status?: number }).status === 409
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
