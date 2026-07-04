import { eq } from "drizzle-orm";
import { createDb, newId, nowIso } from "@/db/client";
import { savedSearches } from "@/db/schema";
import type { SavedSearchCriteria } from "@/core/match";

/**
 * Seed a couple of example saved searches so `npm run digest` has something to
 * evaluate against real listings. Idempotent — upserts by name. Edit these (or
 * add your own rows) to match what you're actually looking for.
 */

const EXAMPLES: Array<{ name: string; criteria: SavedSearchCriteria }> = [
  {
    name: "1BR / large studio near Duboce, dog-friendly",
    criteria: {
      maxPrice: 3200,
      minBedrooms: 0,
      maxBedrooms: 1,
      minSquareFeet: 450,
      neighborhoods: ["Lower Haight", "Duboce Triangle", "Castro", "Hayes Valley"],
      requireDogsAllowed: true,
      laundry: ["in_unit", "in_building"],
      availableBy: new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    },
  },
  {
    name: "Any 1BR under $3,500 citywide",
    criteria: {
      maxPrice: 3500,
      minBedrooms: 1,
      maxBedrooms: 1,
    },
  },
];

const db = await createDb();
const now = nowIso();
let created = 0;
let updated = 0;
for (const ex of EXAMPLES) {
  const existing = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.name, ex.name))
    .get();
  if (existing) {
    await db
      .update(savedSearches)
      .set({ criteria: ex.criteria, updatedAt: now })
      .where(eq(savedSearches.id, existing.id))
      .run();
    updated++;
  } else {
    await db
      .insert(savedSearches)
      .values({
        id: newId("srch"),
        name: ex.name,
        criteria: ex.criteria,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    created++;
  }
}
console.log(`Saved searches seeded: ${created} created, ${updated} updated.`);
for (const ex of EXAMPLES) console.log(`  - ${ex.name}`);
console.log("\nRun `npm run digest` to evaluate them against current listings.");
