"use client";

import type { BadgeKind } from "@/lib/api-types";
import { BADGE_COLORS, BADGE_LABELS } from "@/lib/badges";

export function BadgeChip({ kind }: { kind: BadgeKind }) {
  const color = BADGE_COLORS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {BADGE_LABELS[kind]}
    </span>
  );
}

export function BadgeRow({
  badges,
  max = 3,
}: {
  badges: BadgeKind[];
  max?: number;
}) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const extra = badges.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((b) => (
        <BadgeChip key={b} kind={b} />
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-faint tabular-nums">+{extra}</span>
      )}
    </div>
  );
}
