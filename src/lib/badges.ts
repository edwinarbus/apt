import type { BadgeKind, PriceChangeInfo } from "./api-types";
import type { RunStatus, ScamRiskLevel, StaleStatus, UserListingStatus } from "@/core/types";

/**
 * Badge derivation, done once server-side so the map, cards, and detail view
 * all agree. Order matters — the first badge doubles as the map marker color.
 */

export interface BadgeInput {
  firstSeenAt: string;
  staleStatus: StaleStatus;
  scamRiskLevel: ScamRiskLevel;
  duplicateGroupId: string | null;
  userStatus: UserListingStatus | null;
  lastPriceChange: PriceChangeInfo | null;
  sourceLastRunStatus: RunStatus | null;
  now?: Date;
}

const DAY_MS = 24 * 3600 * 1000;

export function computeBadges(input: BadgeInput): BadgeKind[] {
  const badges: BadgeKind[] = [];
  const now = input.now ?? new Date();

  if (input.userStatus === "saved") badges.push("saved");
  if (input.userStatus === "contacted") badges.push("contacted");
  if (input.userStatus === "maybe") badges.push("maybe");
  if (input.userStatus === "toured") badges.push("toured");
  if (input.userStatus === "applied") badges.push("applied");
  if (input.userStatus === "suspicious") badges.push("suspicious");

  if (input.scamRiskLevel === "verify_carefully") badges.push("verify_carefully");
  else if (input.scamRiskLevel === "watch") badges.push("watch");

  if (input.staleStatus === "likely_unavailable") badges.push("likely_unavailable");
  else if (
    input.staleStatus === "missing_once" ||
    input.staleStatus === "missing_multiple_runs"
  ) {
    badges.push("stale");
  }

  if (
    input.lastPriceChange &&
    now.getTime() - Date.parse(input.lastPriceChange.at) < 14 * DAY_MS
  ) {
    badges.push(
      input.lastPriceChange.newPrice < input.lastPriceChange.oldPrice
        ? "price_drop"
        : "price_increase",
    );
  }

  if (now.getTime() - Date.parse(input.firstSeenAt) < DAY_MS) {
    badges.push("new_today");
  }

  if (input.duplicateGroupId) badges.push("duplicate");

  if (
    input.sourceLastRunStatus === "failed" ||
    input.sourceLastRunStatus === "partial"
  ) {
    badges.push("source_uncertain");
  }

  return badges;
}

export const BADGE_LABELS: Record<BadgeKind, string> = {
  new_today: "New today",
  price_drop: "Price drop",
  price_increase: "Price increase",
  stale: "Missing from source",
  likely_unavailable: "Likely unavailable",
  verify_carefully: "Verify carefully",
  watch: "Watch",
  duplicate: "Possible duplicate",
  saved: "Saved",
  contacted: "Contacted",
  maybe: "Maybe",
  toured: "Toured",
  applied: "Applied",
  suspicious: "Marked suspicious",
  source_uncertain: "Source uncertain",
};

/** Marker + chip colors (hex, used by both the map layers and CSS). */
export const BADGE_COLORS: Record<BadgeKind, string> = {
  new_today: "#1E7F4F",
  price_drop: "#1D63DC",
  price_increase: "#7C5BD1",
  stale: "#8A857B",
  likely_unavailable: "#B0AAA0",
  verify_carefully: "#C2410C",
  watch: "#B45309",
  duplicate: "#64748B",
  saved: "#C43D7E",
  contacted: "#6D28D9",
  maybe: "#0E7490",
  toured: "#0F766E",
  applied: "#4338CA",
  suspicious: "#B91C1C",
  source_uncertain: "#B45309",
};

export const DEFAULT_MARKER_COLOR = "#33302A";

/** The single color a listing's map marker should take (first badge wins). */
export function markerColor(badges: BadgeKind[]): string {
  return badges.length > 0 ? BADGE_COLORS[badges[0]] : DEFAULT_MARKER_COLOR;
}
