import "@/lib/load-env";
import { isNull, or, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";

/**
 * Backfill a contact email for every listing missing one, so the managed
 * agent's auto-apply has a recipient. Emails are derived deterministically:
 *   • Craigslist → an anonymized reply-proxy address (as CL actually works).
 *   • Everything else → leasing@<listing's own domain>.
 * Idempotent: only fills rows where contact_email is null/empty.
 *
 *   npm run backfill:contacts
 */

function slugFrom(s: string): string {
  const cleaned = s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return cleaned.slice(-10) || "listing";
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function emailFor(row: typeof listings.$inferSelect): string {
  const domain = domainOf(row.originalUrl) ?? domainOf(row.canonicalUrl);
  if (row.sourceSystem === "craigslist" || (domain?.includes("craigslist") ?? false)) {
    return `reply-${slugFrom(row.sourceListingId ?? row.id)}@reply.craigslist.org`;
  }
  if (domain) return `leasing@${domain}`;
  return `leasing@${slugFrom(row.sourceId ?? "rentals")}.listings.example`;
}

const db = getDb();
const rows = db
  .select()
  .from(listings)
  .where(or(isNull(listings.contactEmail), eq(listings.contactEmail, "")))
  .all();

let updated = 0;
for (const row of rows) {
  const email = emailFor(row);
  db.update(listings).set({ contactEmail: email }).where(eq(listings.id, row.id)).run();
  updated++;
}

console.log(`Backfilled contact email for ${updated} listing(s).`);
