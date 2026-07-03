"use client";

/**
 * Live analysis feed shown in the results rail while a search runs. Narrates the
 * real pipeline stages as they stream in — no canned spinner, no model name.
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
      className={`flex items-start gap-2.5 text-[13px] transition-opacity duration-300 ${
        state === "pending" ? "opacity-40" : "opacity-100"
      }`}
    >
      <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {state === "done" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="text-good" aria-hidden>
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
      <span className={state === "active" ? "text-ink" : "text-muted"}>{children}</span>
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
  const rankState = kept == null ? "pending" : "active";

  return (
    <div className="animate-fade-in flex flex-col gap-4 px-4 py-5">
      <div className="flex items-center gap-2">
        <span className="flex items-end gap-[3px]" aria-hidden>
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.15s" }} />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.3s" }} />
        </span>
        <span className="text-[13px] font-medium text-ink">Analyzing listings</span>
      </div>

      <ol className="flex flex-col gap-3">
        <Step state={assembleState}>
          {candidates == null
            ? hasLocation
              ? "Gathering active listings near you"
              : "Gathering active SF listings"
            : `Reviewing ${candidates} active listing${candidates === 1 ? "" : "s"}`}
        </Step>
        <Step state={prerankState}>
          {kept == null
            ? "Filtering by location and criteria"
            : `Shortlisted ${kept} candidate${kept === 1 ? "" : "s"}`}
        </Step>
        <Step state={rankState}>
          {model == null
            ? "Preparing to rank matches"
            : chars === 0
              ? "Reading descriptions and photo analysis"
              : "Weighing the best matches for your ask"}
        </Step>
      </ol>

      {chars > 0 && (
        <div className="flex items-center gap-2 pl-[26px] text-[12px] text-faint">
          <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
          Reasoning over the shortlist
        </div>
      )}

      <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
        Matches are cross-referenced against your ask, each listing’s description, photo
        analysis, and SF geography.
      </p>
    </div>
  );
}
