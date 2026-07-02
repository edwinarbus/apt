"use client";

/**
 * Slim live search feed. The sonar itself plays ON the main map (beam sweep,
 * rings, target pings, the hopping designator); this panel narrates the real
 * pipeline stages as they stream in — nothing here is a canned spinner script.
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
  const modelState = kept == null ? "pending" : "active";
  const modelName = model?.includes("sonnet")
    ? "Claude Sonnet"
    : model?.includes("haiku")
      ? "Claude Haiku"
      : model?.includes("opus")
        ? "Claude Opus"
        : "Claude";

  return (
    <div className="animate-fade-in flex flex-col gap-4 px-5 py-6">
      <p className="font-mono text-[10px] tracking-[0.2em] text-[#3fd0ff] uppercase">
        ▶ Sweep live on the map
      </p>
      <ol className="flex flex-col gap-2.5">
        <Step state={assembleState}>
          {candidates == null
            ? hasLocation
              ? "Sweeping the grid from your position…"
              : "Sweeping the SF grid…"
            : `Tracking ${candidates} live listing${candidates === 1 ? "" : "s"}${hasLocation ? " near you" : ""}`}
        </Step>
        <Step state={prerankState}>
          {kept == null
            ? "Sifting for the strongest signals…"
            : `Designating ${kept} candidates on the map`}
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
        <p className="animate-fade-in pl-[30px] font-mono text-[11px] text-faint tabular-nums">
          {(chars / 1000).toFixed(1)}k chars of reasoning
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-faint">
        Every ping on the map is a real listing being considered — cross-referenced
        against your ask, its description, photo analysis, and SF geography.
      </p>
    </div>
  );
}
