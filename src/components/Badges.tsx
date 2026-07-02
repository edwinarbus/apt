"use client";

import type { BadgeKind } from "@/lib/api-types";
import { BADGE_COLORS, BADGE_LABELS } from "@/lib/badges";

export function BadgeChip({ kind }: { kind: BadgeKind }) {
  const color = BADGE_COLORS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.04em] whitespace-nowrap uppercase"
      style={{ backgroundColor: `${color}14`, borderColor: `${color}40`, color }}
    >
      <span className="h-[5px] w-[5px] rounded-[1px]" style={{ backgroundColor: color }} />
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
        <span className="font-mono text-[9.5px] text-faint tabular-nums">+{extra}</span>
      )}
    </div>
  );
}
