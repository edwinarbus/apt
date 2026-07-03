/**
 * Compose a rental application for a listing — the core of Porter's
 * auto-apply. It builds the message + recipient; the app hands it to the user's
 * email client (a one-tap `mailto:` Send) so the human is always the sender.
 * This module has no transport of its own — it never sends anything itself.
 */

export interface DraftListingFacts {
  title: string | null;
  addressRaw: string | null;
  neighborhood: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  priceMonthly: number | null;
  availableDate: string | null;
  originalUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface ApplicationDraft {
  /** best-known recipient (email, else phone), or null if the listing hides it */
  to: string | null;
  channel: "email" | "phone" | "unknown";
  subject: string;
  body: string;
}

/** The tenant's profile, included in every application so it's ready to send. */
const APPLICANT = {
  name: "Edwin Arbus",
  creditScore: 720,
  moveIn: "August 1",
  pet: "one 21 lb dog (adopted via the Scout app)",
};

/**
 * A short, complete, ready-to-send rental application from the tenant to the
 * property. It carries the tenant's real profile (name, credit, move-in, pet),
 * so there are no placeholders — the user just reviews and sends.
 */
export function draftApplication(listing: DraftListingFacts): ApplicationDraft {
  const to = listing.contactEmail ?? listing.contactPhone ?? null;
  const channel: ApplicationDraft["channel"] = listing.contactEmail
    ? "email"
    : listing.contactPhone
      ? "phone"
      : "unknown";

  const where = listing.addressRaw ?? listing.title ?? "your listing";
  const subject = `Application — ${where}`;
  const body = [
    `Hi,`,
    ``,
    `I'm interested in the apartment at ${where} and would like to apply. A bit about me:`,
    ``,
    `  • ${APPLICANT.name}`,
    `  • Credit score: ${APPLICANT.creditScore}`,
    `  • Move-in date: ${APPLICANT.moveIn}`,
    `  • ${APPLICANT.pet}`,
    ``,
    `Could you let me know if it's still available and how to apply? Happy to share anything else you need.`,
    ``,
    `Thanks,`,
    APPLICANT.name,
  ].join("\n");

  return { to, channel, subject, body };
}
