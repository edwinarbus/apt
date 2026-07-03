"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The live activity feed for a search (Claude.ai-style): the real pipeline
 * stages as they stream in, plus Claude's REAL summarized thinking — streamed
 * from the API (adaptive thinking, display: "summarized") — in a collapsible
 * accordion whose header shows the latest thought live. Once the answer lands,
 * the whole activity collapses to a one-line summary the user can re-expand
 * (SearchActivitySummary). No canned spinner, no fake narration.
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
  /** Claude's real summarized thinking, accumulated as it streams */
  thinking: string;
  /** when the search started (ms epoch) — drives the live elapsed readout */
  startedAt: number | null;
  /** total duration, set when the search completes */
  elapsedMs: number | null;
}

export const EMPTY_PROGRESS: SearchProgressState = {
  candidates: null,
  kept: null,
  keptIds: null,
  model: null,
  chars: 0,
  thinking: "",
  startedAt: null,
  elapsedMs: null,
};

/** Split the streamed thinking into displayable thoughts (paragraphs). */
function splitThoughts(thinking: string): string[] {
  return thinking
    .split(/\n{2,}/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function fmtSeconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Dots({ size = 1 }: { size?: number }) {
  const cls = size > 1 ? "h-1.5 w-1.5" : "h-1 w-1";
  return (
    <span className="flex items-end gap-[3px]" aria-hidden>
      <span className={`thinking-dot ${cls} rounded-full bg-accent`} />
      <span className={`thinking-dot ${cls} rounded-full bg-accent`} style={{ animationDelay: "0.15s" }} />
      <span className={`thinking-dot ${cls} rounded-full bg-accent`} style={{ animationDelay: "0.3s" }} />
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
          <Dots />
        ) : (
          <span className="h-1 w-1 rounded-full bg-line-strong" />
        )}
      </span>
      <span className={state === "active" ? "text-ink" : "text-muted"}>{children}</span>
    </li>
  );
}

/**
 * The thinking accordion. Collapsed: the latest thought, updating live.
 * Expanded: the full thought list. Rendered only once real thinking text has
 * arrived — adaptive thinking may skip thinking entirely on a simple ask, and
 * an empty accordion must never show.
 */
function ThinkingAccordion({
  thoughts,
  live,
}: {
  thoughts: string[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const latest = thoughts[thoughts.length - 1] ?? "";

  // Keep the expanded list pinned to the newest thought while streaming.
  useEffect(() => {
    if (open && live && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, live, thoughts]);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-elevated/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-elevated/70"
      >
        {live ? (
          <Dots />
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0 text-faint" aria-hidden>
            <path
              d="M12 3a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.2 1 2V17h6v-.4c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 3ZM10 20h4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {!open && (
          <span className={`min-w-0 flex-1 truncate text-[12.5px] ${live ? "text-muted" : "text-faint"}`}>
            {latest}
          </span>
        )}
        {open && <span className="flex-1 text-[12.5px] font-medium text-muted">Thinking</span>}
        <Chevron open={open} />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div ref={listRef} className="panel-scroll max-h-56 overflow-y-auto border-t border-line px-3 py-2.5">
            <ul className="flex flex-col gap-2">
              {thoughts.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Live activity while the search runs. */
export function SearchProgress({
  progress,
  hasLocation,
}: {
  progress: SearchProgressState;
  hasLocation: boolean;
}) {
  const { candidates, kept, model, chars, thinking, startedAt } = progress;
  const assembleState = candidates == null ? "active" : "done";
  const prerankState = candidates == null ? "pending" : kept == null ? "active" : "done";
  const rankState = kept == null ? "pending" : "active";
  const thoughts = useMemo(() => splitThoughts(thinking), [thinking]);

  // Live elapsed readout while the model works.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = startedAt != null ? now - startedAt : 0;

  return (
    <div className="animate-fade-in flex flex-col gap-4 px-4 py-5">
      <div className="flex items-center gap-2">
        <Dots size={2} />
        <span className="text-[13px] font-medium text-ink">Analyzing listings</span>
        {elapsed > 3000 && <span className="tnum ml-auto text-[12px] text-faint">{fmtSeconds(elapsed)}</span>}
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
            : thoughts.length === 0 && chars === 0
              ? "Reading descriptions and photo analysis"
              : chars > 0
                ? "Writing up the matches"
                : "Weighing the best matches for your ask"}
        </Step>
      </ol>

      {/* Claude's real thinking, streamed. Absent entirely if the model chose not to think. */}
      {thoughts.length > 0 && <ThinkingAccordion thoughts={thoughts} live={chars === 0} />}
    </div>
  );
}

/**
 * Collapsed activity summary shown above the results once the search is done —
 * the auto-collapsed form of the feed, re-expandable to the full thought list.
 */
export function SearchActivitySummary({ progress }: { progress: SearchProgressState }) {
  const [open, setOpen] = useState(false);
  const thoughts = useMemo(() => splitThoughts(progress.thinking), [progress.thinking]);
  if (progress.elapsedMs == null) return null;

  const label =
    thoughts.length > 0
      ? `Thought for ${fmtSeconds(progress.elapsedMs)}`
      : `Ranked ${progress.kept ?? "the"} candidates in ${fmtSeconds(progress.elapsedMs)}`;

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-elevated/50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0 text-faint" aria-hidden>
          <path
            d="M12 3a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.2 1 2V17h6v-.4c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 3ZM10 20h4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[12.5px] text-faint">{label}</span>
        <span className="ml-auto" />
        <Chevron open={open} />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="panel-scroll max-h-64 overflow-y-auto px-4 pb-3">
            {progress.candidates != null && (
              <p className="pb-2 text-[12px] text-faint">
                Reviewed {progress.candidates} listings · shortlisted {progress.kept ?? 0}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {thoughts.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
