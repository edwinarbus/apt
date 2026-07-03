"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live search activity: nothing but Claude's REAL summarized thinking,
 * streamed from the API (adaptive thinking, display: "summarized", low effort)
 * with the latest text always in view. No synthetic stage feed, no accordion —
 * just the model's reasoning as it ranks. Adaptive may skip thinking on a
 * simple ask, so there's a minimal fallback line until text arrives.
 */

export interface SearchProgressState {
  /** null until the first event arrives */
  candidates: number | null;
  kept: number | null;
  /** the actual shortlisted listing ids streamed from the server (map scan) */
  keptIds: string[] | null;
  model: string | null;
  /** characters of the final answer streamed so far */
  chars: number;
  /** Claude's real summarized thinking, accumulated as it streams */
  thinking: string;
  /** when the search started (ms epoch) — drives the live elapsed readout */
  startedAt: number | null;
}

export const EMPTY_PROGRESS: SearchProgressState = {
  candidates: null,
  kept: null,
  keptIds: null,
  model: null,
  chars: 0,
  thinking: "",
  startedAt: null,
};

function fmtSeconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Dots() {
  return (
    <span className="flex items-end gap-[3px]" aria-hidden>
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.15s" }} />
      <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0.3s" }} />
    </span>
  );
}

export function SearchProgress({ progress }: { progress: SearchProgressState }) {
  const { thinking, chars, startedAt } = progress;
  const hasThinking = thinking.trim().length > 0;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Keep the newest thought in view as it streams.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thinking]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = startedAt != null ? now - startedAt : 0;

  const label = chars > 0 ? "Finishing up" : hasThinking ? "Thinking" : "Searching";

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col px-4 py-5">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <Dots />
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {elapsed > 2000 && (
          <span className="tnum ml-auto text-[12px] text-faint">{fmtSeconds(elapsed)}</span>
        )}
      </div>

      {hasThinking ? (
        <div ref={bodyRef} className="panel-scroll min-h-0 flex-1 overflow-y-auto pr-0.5">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
            {thinking.trim()}
          </p>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-faint">
          Reading your search and the listings…
        </p>
      )}
    </div>
  );
}
