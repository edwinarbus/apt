"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Live search progress, ops-room style: a tactical radar of San Francisco
 * where every blip is a REAL active listing (its actual coordinates), the
 * sweep pings them as it passes, and — once the server streams back the real
 * shortlist — the reticle locks target-by-target onto the exact listings
 * Claude is reading. The stage feed below mirrors actual pipeline events;
 * nothing here is a canned spinner script.
 */

export interface SearchProgressState {
  /** null until the first event arrives */
  candidates: number | null;
  kept: number | null;
  /** the actual shortlisted listing ids streamed from the server */
  keptIds: string[] | null;
  model: string | null;
  /** characters of model output streamed so far */
  chars: number;
}

export const EMPTY_PROGRESS: SearchProgressState = {
  candidates: null,
  kept: null,
  keptIds: null,
  model: null,
  chars: 0,
};

export interface RadarPoint {
  id: string;
  lat: number;
  lng: number;
}

/* ---------- SF geometry ---------- */

// City bounds (slightly padded): lng -122.515 → -122.355, lat 37.705 → 37.835.
const LNG_MIN = -122.515;
const LNG_MAX = -122.355;
const LAT_MIN = 37.705;
const LAT_MAX = 37.835;
const SIZE = 200;

function project(lat: number, lng: number): { x: number; y: number } | null {
  if (lng < LNG_MIN || lng > LNG_MAX || lat < LAT_MIN || lat > LAT_MAX) return null;
  return {
    x: ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * SIZE,
    y: ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * SIZE,
  };
}

/** Simplified SF landmass, hand-traced from real coastline anchors. */
const SF_OUTLINE =
  "M48,38 L106,45 L125,42 L138,38 L152,62 L162,100 L175,138 L196,162 L156,177 L172,195 L16,195 L9,131 L6,85 L3,72 L29,69 L40,60 Z";

// Phosphor palette for the dark ops panel (deliberate departure from the warm
// theme — this is the one "military display" surface).
const PHOSPHOR = "#38d183";
const PHOSPHOR_DIM = "#2a9d64";
const TARGET = "#ff7a4d";

const MAX_DOTS = 240;
const SWEEP_SECONDS = 4;

interface Dot {
  id: string;
  x: number;
  y: number;
  /** ping delay so the blip lights up exactly as the beam passes it */
  delay: number;
}

function toDot(p: RadarPoint): Dot | null {
  const xy = project(p.lat, p.lng);
  if (!xy) return null;
  const angle =
    (Math.atan2(xy.x - SIZE / 2, SIZE / 2 - xy.y) * (180 / Math.PI) + 360) % 360;
  return { id: p.id, x: xy.x, y: xy.y, delay: (angle / 360) * SWEEP_SECONDS };
}

function RadarMap({
  progress,
  points,
  userLocation,
}: {
  progress: SearchProgressState;
  points: RadarPoint[];
  userLocation: { lat: number; lng: number } | null;
}) {
  const { candidates, kept, keptIds, chars } = progress;

  const allDots = useMemo(() => {
    const dots: Dot[] = [];
    for (const p of points) {
      const d = toDot(p);
      if (d) dots.push(d);
    }
    return dots;
  }, [points]);

  // Stable sample for render perf; the real shortlist is merged in on arrival.
  const sampled = useMemo(() => {
    if (allDots.length <= MAX_DOTS) return allDots;
    const step = allDots.length / MAX_DOTS;
    const out: Dot[] = [];
    for (let i = 0; i < MAX_DOTS; i++) out.push(allDots[Math.floor(i * step)]);
    return out;
  }, [allDots]);

  const keptSet = useMemo(() => new Set(keptIds ?? []), [keptIds]);
  const dots = useMemo(() => {
    if (keptSet.size === 0) return sampled;
    const present = new Set(sampled.map((d) => d.id));
    const extra = allDots.filter((d) => keptSet.has(d.id) && !present.has(d.id));
    return [...sampled, ...extra];
  }, [sampled, allDots, keptSet]);

  const targets = useMemo(
    () => (keptSet.size > 0 ? dots.filter((d) => keptSet.has(d.id)) : []),
    [dots, keptSet],
  );

  // Target acquisition: step the reticle through the real shortlist.
  const [targetIdx, setTargetIdx] = useState(0);
  useEffect(() => {
    if (targets.length === 0) return;
    const t = setInterval(() => setTargetIdx((i) => i + 1), 850);
    return () => clearInterval(t);
  }, [targets.length]);
  const target = targets.length > 0 ? targets[targetIdx % targets.length] : null;

  const user = userLocation ? project(userLocation.lat, userLocation.lng) : null;
  const shortlisted = keptSet.size > 0;
  const stageCode =
    candidates == null ? "SCAN" : kept == null ? "SIFT" : chars > 0 ? "ANALYZE" : "LOCK";

  return (
    <div className="relative w-full max-w-[330px] overflow-hidden rounded-2xl bg-ink shadow-lg ring-1 ring-line/20">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full" aria-hidden>
        <defs>
          <clipPath id="sf-clip">
            <path d={SF_OUTLINE} />
          </clipPath>
          <radialGradient id="sweep-fade" cx="0" cy="0" r="1">
            <stop offset="0%" stopColor={PHOSPHOR} stopOpacity="0.34" />
            <stop offset="100%" stopColor={PHOSPHOR} stopOpacity="0.05" />
          </radialGradient>
        </defs>

        {/* Tactical grid, clipped to the landmass */}
        <g clipPath="url(#sf-clip)" stroke={PHOSPHOR} strokeOpacity="0.09" strokeWidth="0.5">
          {[25, 50, 75, 100, 125, 150, 175].map((v) => (
            <g key={v}>
              <line x1={v} y1="0" x2={v} y2={SIZE} />
              <line x1="0" y1={v} x2={SIZE} y2={v} />
            </g>
          ))}
        </g>

        {/* Coastline */}
        <path
          d={SF_OUTLINE}
          fill={PHOSPHOR}
          fillOpacity="0.05"
          stroke={PHOSPHOR_DIM}
          strokeOpacity="0.8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* Rotating sweep beam (clipped to the city) */}
        <g clipPath="url(#sf-clip)">
          <g
            className="radar-sweep"
            style={{ transformOrigin: "100px 100px", transformBox: "view-box" }}
          >
            <path
              d="M100,100 L100,-30 A130,130 0 0 1 165,-12.6 Z"
              fill="url(#sweep-fade)"
            />
            <line x1="100" y1="100" x2="100" y2="-30" stroke={PHOSPHOR} strokeOpacity="0.55" strokeWidth="0.8" />
          </g>
        </g>

        {/* Live apartments — real coordinates */}
        {dots.map((d) => {
          const hot = keptSet.has(d.id);
          return (
            <circle
              key={d.id}
              cx={d.x}
              cy={d.y}
              r={hot ? 2.2 : 1.4}
              fill={hot ? PHOSPHOR : PHOSPHOR_DIM}
              className={
                hot ? "radar-dot-hot" : shortlisted ? "radar-dot-cold" : "radar-dot"
              }
              style={hot ? undefined : { animationDelay: `${d.delay.toFixed(2)}s` }}
            />
          );
        })}

        {/* You */}
        {user && (
          <g stroke="#f6f4ef" strokeOpacity="0.85" strokeWidth="0.9">
            <line x1={user.x - 4} y1={user.y} x2={user.x + 4} y2={user.y} />
            <line x1={user.x} y1={user.y - 4} x2={user.x} y2={user.y + 4} />
          </g>
        )}

        {/* Target-acquisition reticle over the actual shortlist */}
        {target && (
          <g
            className="radar-reticle"
            style={{ transform: `translate(${target.x}px, ${target.y}px)` }}
          >
            <g stroke={TARGET} strokeWidth="1.1" fill="none">
              <path d="M-8,-4.5 L-8,-8 L-4.5,-8" />
              <path d="M4.5,-8 L8,-8 L8,-4.5" />
              <path d="M8,4.5 L8,8 L4.5,8" />
              <path d="M-4.5,8 L-8,8 L-8,4.5" />
            </g>
            <circle r="2.6" fill="none" stroke={TARGET} strokeWidth="0.9" className="radar-reticle-pulse" />
          </g>
        )}
      </svg>

      {/* HUD overlays — real numbers only */}
      <div className="pointer-events-none absolute inset-0 p-2.5 font-mono text-[9.5px] tracking-[0.14em] uppercase">
        <div className="flex items-center justify-between" style={{ color: PHOSPHOR }}>
          <span className="flex items-center gap-1.5">
            <span
              className="radar-reticle-pulse inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: PHOSPHOR }}
            />
            SF grid · live
          </span>
          <span>{candidates != null ? `trk ${candidates}` : `trk ${allDots.length}`}</span>
        </div>
        <div
          className="absolute right-2.5 bottom-2.5 left-2.5 flex items-center justify-between"
          style={{ color: PHOSPHOR }}
        >
          <span style={stageCode === "ANALYZE" || stageCode === "LOCK" ? { color: TARGET } : undefined}>
            {stageCode}
            {kept != null ? ` · ${kept}` : ""}
          </span>
          <span>{chars > 0 ? `${(chars / 1000).toFixed(1)}k` : "—"}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Live stage feed ---------- */

function Step({
  state,
  children,
}: {
  state: "pending" | "active" | "done";
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex items-center gap-2.5 text-[13px] transition-opacity duration-300 ${
        state === "pending" ? "opacity-35" : "opacity-100"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {state === "done" ? (
          <span className="animate-pop-in flex h-5 w-5 items-center justify-center rounded-full bg-good/12 text-[11px] text-good">
            ✓
          </span>
        ) : state === "active" ? (
          <span className="flex items-end gap-[3px]">
            <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.15s" }} />
            <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.3s" }} />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-line" />
        )}
      </span>
      <span className={state === "active" ? "shimmer-text font-medium" : "text-muted"}>
        {children}
      </span>
    </li>
  );
}

export function SearchProgress({
  progress,
  hasLocation,
  points,
  userLocation,
}: {
  progress: SearchProgressState;
  hasLocation: boolean;
  points: RadarPoint[];
  userLocation: { lat: number; lng: number } | null;
}) {
  const { candidates, kept, model, chars } = progress;
  const assembleState = candidates == null ? "active" : "done";
  const prerankState = candidates == null ? "pending" : kept == null ? "active" : "done";
  const modelState = kept == null ? "pending" : "active";
  const modelName = model?.includes("sonnet")
    ? "Claude Sonnet"
    : model?.includes("haiku")
      ? "Claude Haiku"
      : model?.includes("opus")
        ? "Claude Opus"
        : "Claude";

  return (
    <div className="animate-fade-in flex flex-col items-center gap-5 px-5 py-6">
      <RadarMap progress={progress} points={points} userLocation={userLocation} />
      <div className="w-full max-w-[310px]">
        <ol className="flex flex-col gap-2.5">
          <Step state={assembleState}>
            {candidates == null
              ? "Sweeping the live SF grid…"
              : `Tracking ${candidates} live listing${candidates === 1 ? "" : "s"}${hasLocation ? " near you" : ""}`}
          </Step>
          <Step state={prerankState}>
            {kept == null
              ? "Sifting for the strongest signals…"
              : `Locked a shortlist of ${kept}`}
          </Step>
          <Step state={modelState}>
            {model == null
              ? "Waking the model…"
              : chars === 0
                ? `${modelName} is reading descriptions & photo analysis…`
                : `${modelName} is weighing the matches…`}
          </Step>
        </ol>
        {chars > 0 && (
          <p className="animate-fade-in mt-3 pl-[30px] font-mono text-[11px] text-faint tabular-nums">
            {(chars / 1000).toFixed(1)}k chars of reasoning
          </p>
        )}
      </div>
      <p className="max-w-[290px] text-center text-[11.5px] leading-relaxed text-faint">
        Every blip is a real listing. Cross-referencing your ask against each one&apos;s
        data, description, and photo analysis — plus SF geography.
      </p>
    </div>
  );
}
