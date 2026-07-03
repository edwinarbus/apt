"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live search activity: nothing but Claude's REAL summarized thinking,
 * streamed from the API (adaptive thinking, display: "summarized", low effort).
 * Each summary paragraph renders as its own thought — earlier ones recede,
 * the newest stays bright with a live caret — so long reasoning stays
 * scannable instead of piling into one wall of text. Adaptive may skip
 * thinking on a simple ask, so there's a minimal fallback line.
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

/** Quiet ring spinner in the app palette — a faint track with an accent arc. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-none"
    />
  );
}

export function SearchProgress({ progress }: { progress: SearchProgressState }) {
  const { thinking, chars, startedAt } = progress;
  // Summarized thinking arrives in paragraph-sized chunks — present each as
  // its own thought instead of one accumulated wall.
  const paras = thinking.trim() ? thinking.trim().split(/\n{2,}/) : [];
  const stillThinking = chars === 0;

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

  const label = !stillThinking ? "Finishing up" : paras.length ? "Thinking" : "Searching";

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col px-4 pt-4 pb-2">
      <div className="flex shrink-0 items-center gap-2">
        <Spinner />
        <span className="shimmer-text text-[13px] font-semibold">{label}</span>
        {elapsed > 2000 && (
          <span className="tnum ml-auto text-[11.5px] text-faint">{fmtSeconds(elapsed)}</span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={bodyRef} className="panel-scroll h-full overflow-y-auto pt-3 pb-1">
          {paras.length > 0 ? (
            <div className="flex flex-col gap-3 border-l border-line pl-3">
              {paras.map((p, i) => {
                const latest = i === paras.length - 1;
                return (
                  <p
                    key={i}
                    className={`text-[12.5px] leading-relaxed whitespace-pre-wrap transition-colors duration-500 ${
                      latest && stillThinking ? "text-muted" : "text-faint"
                    }`}
                  >
                    {p}
                    {latest && stillThinking && (
                      <span aria-hidden className="thinking-caret ml-1" />
                    )}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="shimmer-text text-[12.5px] leading-relaxed">
              Reading your search and the listings…
            </p>
          )}
        </div>
        {/* older thoughts slide away under a quiet fade */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-surface to-transparent" />
      </div>
    </div>
  );
}
