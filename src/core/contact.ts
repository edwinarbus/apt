/**
 * Contact resolution: source-level contact info is the default; a listing
 * only overrides it when the listing page itself published something more
 * specific. Only publicly visible contact info is ever stored.
 */

export interface ContactFields {
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactUrl: string | null;
}

export interface SourceContactFields {
  name: string;
  phone: string | null;
  email: string | null;
  contactUrl: string | null;
  websiteUrl: string | null;
}

export interface ResolvedContact extends ContactFields {
  /** which fields came from the listing itself vs the source record */
  inheritedFromSource: boolean;
  sourceWebsiteUrl: string | null;
}

export function resolveContact(
  listing: ContactFields,
  source: SourceContactFields,
): ResolvedContact {
  const hasOwn =
    listing.contactName != null ||
    listing.contactPhone != null ||
    listing.contactEmail != null ||
    listing.contactUrl != null;
  return {
    contactName: listing.contactName ?? source.name,
    contactPhone: listing.contactPhone ?? source.phone,
    contactEmail: listing.contactEmail ?? source.email,
    contactUrl: listing.contactUrl ?? source.contactUrl,
    inheritedFromSource: !hasOwn,
    sourceWebsiteUrl: source.websiteUrl,
  };
}
