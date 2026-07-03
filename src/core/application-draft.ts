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

function bedLabel(beds: number | null): string {
  if (beds == null) return "unit";
  if (beds === 0) return "studio";
  return `${beds}-bed`;
}

function money(n: number | null): string | null {
  return n == null ? null : `$${Math.round(n).toLocaleString()}/mo`;
}

/**
 * A short, specific, polite application inquiry. The tenant's own details are
 * left as clearly-marked placeholders for the user to fill before sending —
 * the agent never invents personal information.
 */
export function draftApplication(
  listing: DraftListingFacts,
  opts: { searchName?: string } = {},
): ApplicationDraft {
  const to = listing.contactEmail ?? listing.contactPhone ?? null;
  const channel: ApplicationDraft["channel"] = listing.contactEmail
    ? "email"
    : listing.contactPhone
      ? "phone"
      : "unknown";

  const where =
    [listing.addressRaw, listing.neighborhood].filter(Boolean).join(", ") ||
    listing.title ||
    "your listing";
  const specifics = [bedLabel(listing.bedrooms), money(listing.priceMonthly)]
    .filter(Boolean)
    .join(", ");
  const availLine = listing.availableDate
    ? ` I saw it's available around ${listing.availableDate}.`
    : "";

  const subject = `Application inquiry — ${where}`;
  const body = [
    `Hi,`,
    ``,
    `I'm very interested in the ${specifics} at ${where} and would like to apply.${availLine} It's an excellent fit for what I'm looking for${opts.searchName ? ` (${opts.searchName})` : ""}.`,
    ``,
    `Could you let me know whether it's still available, and how you'd like me to submit an application? I'm ready to move quickly and can provide:`,
    `  • [Your full name and phone]`,
    `  • [Monthly income / proof of income]`,
    `  • [Credit / background details as required]`,
    `  • [Preferred move-in date]`,
    ``,
    `Happy to schedule a tour at your convenience. Thank you!`,
    ``,
    `[Your name]`,
  ].join("\n");

  return { to, channel, subject, body };
}
