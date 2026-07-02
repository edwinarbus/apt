/** Client-safe formatting helpers. */

export function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function fmtMoneyShort(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 10000) return `$${Math.round(value / 1000)}k`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(value)}`;
}

export function fmtBeds(bedrooms: number | null | undefined): string {
  if (bedrooms == null) return "? bd";
  if (bedrooms === 0) return "Studio";
  return `${bedrooms} bd`;
}

export function fmtBaths(bathrooms: number | null | undefined): string {
  if (bathrooms == null) return "? ba";
  return `${bathrooms} ba`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const PRECISION_LABELS: Record<string, string> = {
  exact_address: "exact address",
  building: "building-level",
  block: "block-level",
  neighborhood: "neighborhood-level (approximate)",
  city: "city-level (approximate)",
  unknown: "location unknown",
};
