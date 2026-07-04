import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, nowIso } from "@/db/client";
import { listings, listingVision, userListingStates } from "@/db/schema";
import { DislikeMemoryStore } from "@/memory/store";
import type { DislikeFacts } from "@/memory/characteristics";

export const dynamic = "force-dynamic";

/**
 * Thumbs-down a listing. Locally this marks it `not_a_fit` (so it drops out of
 * the results, exactly like the old Hide), and it records the apartment's basic
 * characteristics in the Claude memory store so Porter can learn what to steer
 * away from. Un-thumbs-down (`disliked: false`) clears both. The memory-store
 * write is best-effort — the local mark is the source of truth for the app.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const row = await db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "listing not found" }, { status: 404 });
  }

  let body: { disliked?: boolean };
  try {
    body = (await req.json()) as { disliked?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const disliked = body.disliked !== false; // default to disliking

  const now = nowIso();
  const store = new DislikeMemoryStore();

  if (!disliked) {
    await db.delete(userListingStates).where(eq(userListingStates.listingId, id)).run();
    const outcome = await store.forget(id);
    return NextResponse.json({ ok: true, status: null, remembered: false, memory: outcome });
  }

  await db
    .insert(userListingStates)
    .values({ listingId: id, status: "not_a_fit", note: null, updatedAt: now })
    .onConflictDoUpdate({
      target: userListingStates.listingId,
      set: { status: "not_a_fit", note: null, updatedAt: now },
    })
    .run();

  const vision = await db
    .select({ features: listingVision.features })
    .from(listingVision)
    .where(eq(listingVision.listingId, id))
    .get();

  const facts: DislikeFacts = {
    title: row.title,
    addressRaw: row.addressRaw,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    priceMonthly: row.priceEffectiveMonthly ?? row.priceMonthly,
    neighborhood: row.neighborhood,
    parking: row.parkingNormalized,
    laundry: row.laundryNormalized,
    catsAllowed: row.catsAllowed,
    dogsAllowed: row.dogsAllowed,
    squareFeet: row.squareFeet,
    propertyType: row.propertyType,
    visualTags: vision?.features ?? [],
    description: row.description,
  };

  const outcome = await store.remember(id, facts);
  return NextResponse.json({ ok: true, status: "not_a_fit", remembered: true, memory: outcome });
}
