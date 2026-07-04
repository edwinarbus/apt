import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, newId, nowIso } from "@/db/client";
import { listings, listingVision, savedSearches, userListingStates } from "@/db/schema";
import { evaluateListing, type MatchableListing, type SavedSearchCriteria } from "@/core/match";
import { draftApplication } from "@/core/application-draft";
import { characteristicTags, type DislikeFacts } from "@/memory/characteristics";
import { curateMatches, curationNote, inferAversions } from "@/memory/curate";
import type { UserListingStatus } from "@/core/types";
import type { SavedSearchDto, SavedSearchesResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

type ListingRow = typeof listings.$inferSelect;

/** The basic characteristics of one apartment, for dislike-recurrence matching. */
function factsFor(row: ListingRow, visualTags: string[]): DislikeFacts {
  return {
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
    visualTags,
    description: row.description,
  };
}

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
  const db = await getDb();
  const searches = await db.select().from(savedSearches).orderBy(desc(savedSearches.createdAt)).all();
  const rows = await db.select().from(listings).all();
  const statusById = new Map(
    (await db.select().from(userListingStates).all()).map((s) => [s.listingId, s.status as UserListingStatus]),
  );
  const visualTagsById = new Map(
    (
      await db
        .select({ listingId: listingVision.listingId, features: listingVision.features })
        .from(listingVision)
        .all()
    ).map((v) => [v.listingId, v.features ?? []]),
  );
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();

  const active = rows.filter(
    (r) => r.listingStatus === "active" && r.staleStatus !== "likely_unavailable",
  );

  // Learn what the user keeps passing on. The disliked set is every listing the
  // user thumbs-downed (marked not_a_fit); recurring characteristics across them
  // become light "aversions" Porter steers the shortlist away from. Tags are
  // computed lazily and only when there's actually something to curate against.
  const dislikedRows = [...statusById.entries()]
    .filter(([, status]) => status === "not_a_fit")
    .map(([id]) => rowsById.get(id))
    .filter((r): r is ListingRow => r != null);
  const aversions = inferAversions(
    dislikedRows.map((r) => characteristicTags(factsFor(r, visualTagsById.get(r.id) ?? []))),
  );
  const tagCache = new Map<string, string[]>();
  const tagsFor = (r: ListingRow): string[] => {
    let tags = tagCache.get(r.id);
    if (!tags) {
      tags = characteristicTags(factsFor(r, visualTagsById.get(r.id) ?? []));
      tagCache.set(r.id, tags);
    }
    return tags;
  };

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
    // Curate the surfaced shortlist toward the least-shared aversions (best fit
    // first), dropping the few that hit a strong recurring dislike. matchCount
    // stays the raw criteria count; only what Porter surfaces is curated.
    const shortlist = aversions.length
      ? curateMatches(matching.map((r) => ({ item: r, tags: tagsFor(r) })), aversions).kept
      : matching;
    const newMatches = shortlist.filter((r) => now - Date.parse(r.firstSeenAt) < DAY_MS);

    // Auto-apply: prepare a ready-to-send application for each new match.
    const applications: SavedSearchDto["applications"] = criteria.autoApply
      ? (newMatches.length ? newMatches : shortlist).slice(0, 5).map((target) => {
          const d = draftApplication({
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
          });
          return {
            listingId: target.id,
            listingTitle: target.title,
            addressLine:
              [target.addressRaw, target.neighborhood].filter(Boolean).join(" · ") || null,
            priceMonthly: target.priceEffectiveMonthly ?? target.priceMonthly,
            primaryPhotoUrl: target.primaryPhotoUrl,
            to: d.to,
            channel: d.channel,
            subject: d.subject,
            body: d.body,
          };
        })
      : [];

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
      applications,
    };
  });

  return NextResponse.json({
    searches: dtos,
    curated: aversions.length > 0,
    curationNote: curationNote(aversions),
  } satisfies SavedSearchesResponse);
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

  const db = await getDb();
  const now = nowIso();
  const id = newId("srch");
  await db
    .insert(savedSearches)
    .values({ id, name, criteria, enabled: true, createdAt: now, updatedAt: now })
    .run();

  return NextResponse.json({ id, name }, { status: 201 });
}
