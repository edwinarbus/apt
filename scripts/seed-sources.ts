import { eq } from "drizzle-orm";
import { createDb, nowIso } from "@/db/client";
import { sources } from "@/db/schema";
import { SOURCE_SEEDS } from "@/config/sources";

/**
 * Upsert the SF source registry. Descriptive/config fields are refreshed from
 * code on every run, but `enabled` and live robots state are preserved for
 * existing rows so manual toggles aren't clobbered.
 * `--reset-enabled` restores the seed's enabled flags too.
 */

const resetEnabled = process.argv.includes("--reset-enabled");
const db = createDb();
const now = nowIso();

let inserted = 0;
let updated = 0;
for (const seed of SOURCE_SEEDS) {
  const existing = db.select().from(sources).where(eq(sources.id, seed.id)).get();
  if (!existing) {
    db.insert(sources).values({ ...seed, createdAt: now, updatedAt: now }).run();
    inserted++;
  } else {
    const { enabled, ...rest } = seed;
    db.update(sources)
      .set({
        ...rest,
        ...(resetEnabled ? { enabled } : {}),
        updatedAt: now,
      })
      .where(eq(sources.id, seed.id))
      .run();
    updated++;
  }
}

const all = db.select().from(sources).all();
console.log(`Seeded source registry: ${inserted} inserted, ${updated} updated.\n`);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  pad("id", 24) + pad("enabled", 9) + pad("adapter", 14) + pad("priority", 16) + "status notes",
);
for (const s of all) {
  console.log(
    pad(s.id, 24) +
      pad(s.enabled ? "yes" : "no", 9) +
      pad(s.adapterType, 14) +
      pad(s.priority, 16) +
      (s.sourceStatusNotes ?? "").slice(0, 80),
  );
}
