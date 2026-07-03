import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, newId, nowIso } from "@/db/client";
import { listings, savedSearches, userListingStates } from "@/db/schema";
import { evaluateListing, type MatchableListing, type SavedSearchCriteria } from "@/core/match";
import { draftApplication } from "@/core/application-draft";
import type { UserListingStatus } from "@/core/types";
import type { SavedSearchDto, SavedSearchesResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

function toMatchable(row: typeof listings.$inferSelect): MatchableListing {
  return {
    priceMonthly: row.priceMonthly,
    priceEffectiveMonthly: row.priceEffectiveMonthly,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    squareFeet: row.squareFeet,
    pricePerSquareFoot: row.pricePerSquareFoot,
    neighborhood: row.neighborhood,
    catsAllowed: row.catsAllowed,
    dogsAllowed: row.dogsAllowed,
    laundryNormalized: row.laundryNormalized,
    parkingNormalized: row.parkingNormalized,
    availableDate: row.availableDate,
    latitude: row.latitude,
    longitude: row.longitude,
    title: row.title,
    description: row.description,
  };
}

/** Assemble the watched-search view: each saved search + how many active
 * listings currently match, how many are new in the last day, and (for
 * auto-apply searches) a drafted application for the freshest match. */
export async function GET() {
  const db = getDb();
  const searches = db.select().from(savedSearches).orderBy(desc(savedSearches.createdAt)).all();
  const rows = db.select().from(listings).all();
  const statusById = new Map(
    db.select().from(userListingStates).all().map((s) => [s.listingId, s.status as UserListingStatus]),
  );
  const now = Date.now();

  const active = rows.filter(
    (r) => r.listingStatus === "active" && r.staleStatus !== "likely_unavailable",
  );

  const dtos: SavedSearchDto[] = searches.map((s) => {
    const criteria = (s.criteria ?? {}) as SavedSearchCriteria;
    const matching = active.filter((r) => {
      const res = evaluateListing(toMatchable(r), criteria, statusById.get(r.id) ?? null);
      // Count a match only when known criteria pass AND, if the search names a
      // neighborhood, the listing is actually IN it (not merely unknown) — so a
      // "watched: Outer Richmond" count never includes unplaced listings.
      return res.eligible && res.matched && !res.unknowns.includes("neighborhood");
    });
    // Freshest match first.
    matching.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));
    const newMatches = matching.filter((r) => now - Date.parse(r.firstSeenAt) < DAY_MS);

    let sampleDraft: SavedSearchDto["sampleDraft"] = null;
    if (criteria.autoApply) {
      const target = newMatches[0] ?? matching[0];
      if (target) {
        const d = draftApplication(
          {
            title: target.title,
            addressRaw: target.addressRaw,
            neighborhood: target.neighborhood,
            bedrooms: target.bedrooms,
            bathrooms: target.bathrooms,
            priceMonthly: target.priceEffectiveMonthly ?? target.priceMonthly,
            availableDate: target.availableDate,
            originalUrl: target.originalUrl,
            contactEmail: target.contactEmail,
            contactPhone: target.contactPhone,
          },
          { searchName: s.name },
        );
        sampleDraft = {
          listingId: target.id,
          listingTitle: target.title,
          to: d.to,
          channel: d.channel,
          subject: d.subject,
          body: d.body,
        };
      }
    }

    return {
      id: s.id,
      name: s.name,
      query: criteria.query ?? null,
      autoApply: criteria.autoApply ?? false,
      enabled: s.enabled,
      createdAt: s.createdAt,
      matchCount: matching.length,
      newMatchCount: newMatches.length,
      newMatchIds: newMatches.slice(0, 6).map((r) => r.id),
      sampleDraft,
    };
  });

  return NextResponse.json({ searches: dtos } satisfies SavedSearchesResponse);
}

interface CreateBody {
  name?: string;
  query?: string;
  criteria?: SavedSearchCriteria;
  autoApply?: boolean;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const query = (body.query ?? "").trim();
  const name = (body.name ?? "").trim() || query || "Saved search";
  if (!query && !body.criteria) {
    return NextResponse.json({ error: "a query or criteria is required" }, { status: 400 });
  }

  const criteria: SavedSearchCriteria = {
    ...(body.criteria ?? {}),
    query: query || undefined,
    autoApply: body.autoApply ?? false,
  };

  const db = getDb();
  const now = nowIso();
  const id = newId("srch");
  db.insert(savedSearches)
    .values({ id, name, criteria, enabled: true, createdAt: now, updatedAt: now })
    .run();

  return NextResponse.json({ id, name }, { status: 201 });
}
