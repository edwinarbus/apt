"use client";

/**
 * Slim live search feed. The sweep itself plays ON the main map; this panel
 * narrates the real pipeline stages as they stream in — nothing here is a
 * canned spinner script. Terse, operational, mono.
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
      className={`flex items-center gap-2.5 font-mono text-[12px] tracking-[0.02em] transition-opacity duration-300 ${
        state === "pending" ? "opacity-35" : "opacity-100"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {state === "done" ? (
          <span className="animate-rise-in text-[11px] text-good">✓</span>
        ) : state === "active" ? (
          <span className="flex items-end gap-[3px]">
            <span className="thinking-dot h-1 w-1 rounded-full bg-accent" />
            <span className="thinking-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "0.15s" }} />
            <span className="thinking-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "0.3s" }} />
          </span>
        ) : (
          <span className="h-1 w-1 rounded-full bg-line-strong" />
        )}
      </span>
      <span className={state === "active" ? "scan-text" : "text-muted"}>{children}</span>
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
    <div className="animate-fade-in flex flex-col gap-4 px-4 py-5">
      <p className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.2em] text-accent uppercase">
        <span className="soft-pulse h-1.5 w-1.5 rounded-full bg-accent" />
        Sweep live on map
      </p>
      <ol className="flex flex-col gap-2.5">
        <Step state={assembleState}>
          {candidates == null
            ? hasLocation
              ? "Sweeping grid from your position"
              : "Sweeping SF grid"
            : `${candidates} live listing${candidates === 1 ? "" : "s"} in range`}
        </Step>
        <Step state={prerankState}>
          {kept == null ? "Prefiltering signals" : `${kept} candidates designated`}
        </Step>
        <Step state={modelState}>
          {model == null
            ? "Model standby"
            : chars === 0
              ? `${modelName} reading descriptions + vision`
              : `${modelName} weighing matches`}
        </Step>
      </ol>
      {chars > 0 && (
        <p className="animate-fade-in pl-[26px] font-mono text-[10.5px] text-faint tabular-nums">
          {(chars / 1000).toFixed(1)}K chars reasoning
        </p>
      )}
      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        Every ping on the map is a real listing under evaluation — cross-referenced against
        your ask, its description, photo analysis, and SF geography.
      </p>
    </div>
  );
}
