import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { savedSearches, savedSearchMatches } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Unfollow (delete) a watched search. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const db = await getDb();
  // Remove any recorded matches first (FK), then the search itself.
  await db.delete(savedSearchMatches).where(eq(savedSearchMatches.savedSearchId, id)).run();
  await db.delete(savedSearches).where(eq(savedSearches.id, id)).run();

  return NextResponse.json({ ok: true });
}
