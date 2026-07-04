import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, nowIso } from "@/db/client";
import { listings, userListingStates } from "@/db/schema";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "saved",
  "hidden",
  "contacted",
  "not_a_fit",
  "maybe",
  "toured",
  "applied",
  "rented_elsewhere",
  "suspicious",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const row = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.id, id))
    .get();
  if (!row) {
    return NextResponse.json({ error: "listing not found" }, { status: 404 });
  }

  let body: { status?: string | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.status == null) {
    await db
      .delete(userListingStates)
      .where(eq(userListingStates.listingId, id))
      .run();
    return NextResponse.json({ ok: true, status: null });
  }

  if (!VALID_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `invalid status: ${body.status}` },
      { status: 400 },
    );
  }

  const now = nowIso();
  await db
    .insert(userListingStates)
    .values({
      listingId: id,
      status: body.status,
      note: body.note ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userListingStates.listingId,
      set: { status: body.status, note: body.note ?? null, updatedAt: now },
    })
    .run();
  return NextResponse.json({ ok: true, status: body.status });
}
