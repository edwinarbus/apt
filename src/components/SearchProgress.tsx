"use client";

/**
 * Live search progress: a playful shuffle of dog "listing cards" while the
 * real pipeline stages stream in from /api/search (assemble → shortlist →
 * Claude reading → reasoning ticker). Every line reflects an actual event —
 * nothing here is a fake spinner script.
 */

export interface SearchProgressState {
  /** null until the first event arrives */
  candidates: number | null;
  kept: number | null;
  model: string | null;
  /** characters of model output streamed so far */
  chars: number;
}

export const EMPTY_PROGRESS: SearchProgressState = {
  candidates: null,
  kept: null,
  model: null,
  chars: 0,
};

/* ---------- Cute flat dogs (inline SVG, theme-tinted) ---------- */

function DogA() {
  // floppy-eared terracotta pup
  return (
    <svg viewBox="0 0 80 80" className="h-14 w-14" aria-hidden>
      <circle cx="40" cy="46" r="22" fill="#e8a888" />
      <ellipse cx="26" cy="30" rx="9" ry="14" fill="#bf4e2c" transform="rotate(-18 26 30)" />
      <ellipse cx="54" cy="30" rx="9" ry="14" fill="#bf4e2c" transform="rotate(18 54 30)" />
      <circle cx="40" cy="42" r="17" fill="#f3c9b1" />
      <circle cx="33" cy="40" r="2.6" fill="#23211c" />
      <circle cx="47" cy="40" r="2.6" fill="#23211c" />
      <ellipse cx="40" cy="48" rx="4.5" ry="3.4" fill="#23211c" />
      <path d="M40 51 q0 4 -4 5 M40 51 q0 4 4 5" stroke="#23211c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <g className="wag">
        <path d="M62 58 q10 -4 8 -13" stroke="#bf4e2c" strokeWidth="5" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function DogB() {
  // perky-eared ink-and-cream pup
  return (
    <svg viewBox="0 0 80 80" className="h-14 w-14" aria-hidden>
      <path d="M22 32 L28 14 L36 28 Z" fill="#6f6a5e" />
      <path d="M58 32 L52 14 L44 28 Z" fill="#6f6a5e" />
      <circle cx="40" cy="46" r="22" fill="#d8d2c4" />
      <circle cx="40" cy="42" r="17" fill="#efe9dc" />
      <circle cx="33" cy="40" r="2.6" fill="#23211c" />
      <circle cx="47" cy="40" r="2.6" fill="#23211c" />
      <circle cx="47" cy="40" r="7.5" fill="none" stroke="#6f6a5e" strokeWidth="2.4" />
      <ellipse cx="40" cy="48" rx="4.2" ry="3.2" fill="#23211c" />
      <path d="M34 54 q6 4 12 0" stroke="#23211c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <g className="wag" style={{ animationDelay: "0.2s" }}>
        <path d="M62 58 q11 -2 10 -11" stroke="#6f6a5e" strokeWidth="5" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function DogC() {
  // round golden pup with a heart nose
  return (
    <svg viewBox="0 0 80 80" className="h-14 w-14" aria-hidden>
      <ellipse cx="24" cy="34" rx="8" ry="12" fill="#b45309" transform="rotate(-24 24 34)" />
      <ellipse cx="56" cy="34" rx="8" ry="12" fill="#b45309" transform="rotate(24 56 34)" />
      <circle cx="40" cy="46" r="22" fill="#e6b980" />
      <circle cx="40" cy="42" r="17" fill="#f4d9ae" />
      <path d="M31 38 q2 -3 4 0 M45 38 q2 -3 4 0" stroke="#23211c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M40 46 l-3.4 -3 a2.3 2.3 0 1 1 3.4 -2 a2.3 2.3 0 1 1 3.4 2 z" fill="#23211c" />
      <path d="M40 47 q0 4 -5 5 M40 47 q0 4 5 5" stroke="#23211c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M37 30 q3 -4 6 0" stroke="#b45309" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <g className="wag" style={{ animationDelay: "0.4s" }}>
        <path d="M61 60 q12 0 12 -10" stroke="#b45309" strokeWidth="5" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const DOGS = [DogA, DogB, DogC];
const CARD_META = [
  { tilt: "-6deg", delay: "0s", price: "$2,450", line: "w-16" },
  { tilt: "1deg", delay: "1.2s", price: "$3,895", line: "w-12" },
  { tilt: "7deg", delay: "2.4s", price: "$1,995", line: "w-20" },
];

function DogCardShuffle() {
  return (
    <div className="relative mx-auto h-[132px] w-[190px]" aria-hidden>
      {CARD_META.map((meta, i) => {
        const Dog = DOGS[i];
        return (
          <div
            key={i}
            className="shuffle-card absolute top-1/2 left-1/2 w-[118px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-2.5 shadow-md"
            style={{ "--tilt": meta.tilt, animationDelay: meta.delay } as React.CSSProperties}
          >
            <div className="flex justify-center rounded-lg bg-paper py-1">
              <Dog />
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="h-2 w-10 rounded-full bg-ink/70 text-transparent" />
              <div className={`h-1.5 ${meta.line} rounded-full bg-line`} />
              <div className="h-1.5 w-14 rounded-full bg-line/70" />
            </div>
          </div>
        );
      })}
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
}: {
  progress: SearchProgressState;
  hasLocation: boolean;
}) {
  const { candidates, kept, model, chars } = progress;
  const assembleState = candidates == null ? "active" : "done";
  const prerankState = candidates == null ? "pending" : kept == null ? "active" : "done";
  const modelState = kept == null ? "pending" : model == null ? "active" : chars > 0 ? "active" : "active";
  const modelName = model?.includes("sonnet")
    ? "Claude Sonnet"
    : model?.includes("haiku")
      ? "Claude Haiku"
      : model?.includes("opus")
        ? "Claude Opus"
        : "Claude";

  return (
    <div className="animate-fade-in flex flex-col items-center gap-5 px-6 py-10">
      <DogCardShuffle />
      <div className="w-full max-w-[300px]">
        <ol className="flex flex-col gap-2.5">
          <Step state={assembleState}>
            {candidates == null
              ? hasLocation
                ? "Gathering listings near you…"
                : "Gathering active listings…"
              : `Gathered ${candidates} active listing${candidates === 1 ? "" : "s"}${hasLocation ? " near you" : ""}`}
          </Step>
          <Step state={prerankState}>
            {kept == null ? "Shortlisting the strongest fits…" : `Shortlisted ${kept} for a close read`}
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
      <p className="max-w-[280px] text-center text-[11.5px] leading-relaxed text-faint">
        Cross-referencing your ask against each listing&apos;s data, description, and
        photo analysis — plus SF geography.
      </p>
    </div>
  );
}
