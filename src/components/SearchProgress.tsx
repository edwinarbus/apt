"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Before the server sends its first progress event (or any real thinking),
 * there's genuinely nothing to report yet — but a static "Reading your
 * search…" for that whole dead-air window reads as stuck. Cycle through a
 * handful of phrases tied to what the query actually asked for instead, so it
 * reads as real (if lightweight) activity. Purely local pattern matching —
 * no API call, so it can start instantly and doesn't compete with the actual
 * search for latency.
 */
const QUERY_PHRASE_RULES: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /\bsun(ny|light|-?filled)?\b/i, phrase: "Analyzing sun's trajectory…" },
  { pattern: /\bhardwood|wood floor/i, phrase: "Looking at floor materials…" },
  { pattern: /\bdog(s)?\b/i, phrase: "Identifying dog parks…" },
  { pattern: /\bcat(s)?\b/i, phrase: "Checking pet policies…" },
  { pattern: /\bpet-?friendly\b/i, phrase: "Checking pet policies…" },
  { pattern: /\bpark(ing)?\b/i, phrase: "Mapping parking options…" },
  { pattern: /\bquiet|peaceful|calm\b/i, phrase: "Estimating noise levels…" },
  { pattern: /\bview\b/i, phrase: "Scouting for skyline views…" },
  { pattern: /\blaundry|washer|dryer|w\/d\b/i, phrase: "Checking laundry setups…" },
  { pattern: /\bkitchen|renovated|updated|modern\b/i, phrase: "Inspecting kitchen finishes…" },
  { pattern: /\btransit|bart|muni|\bbus\b/i, phrase: "Mapping transit access…" },
  { pattern: /\bgym|fitness\b/i, phrase: "Scanning for fitness amenities…" },
  { pattern: /\bsafe|safety\b/i, phrase: "Reading neighborhood signals…" },
  { pattern: /\bcheap|afford|budget|under \$?\d/i, phrase: "Comparing prices citywide…" },
  { pattern: /\bstudio\b/i, phrase: "Sizing up studio layouts…" },
  { pattern: /\bbed(room)?s?\b/i, phrase: "Counting bedrooms…" },
  { pattern: /\bbay window/i, phrase: "Spotting bay windows…" },
  { pattern: /\bgarden|yard|patio|backyard|outdoor/i, phrase: "Looking for outdoor space…" },
  { pattern: /\belevator\b/i, phrase: "Checking building access…" },
  { pattern: /\bnear|close to|walk(ing)? distance|walkable/i, phrase: "Measuring walk times…" },
  { pattern: /\bfurnished\b/i, phrase: "Checking furnished listings…" },
  { pattern: /\broommate|shared\b/i, phrase: "Reviewing shared-living setups…" },
  { pattern: /\bnew(ly)?|remodel/i, phrase: "Spotting recent renovations…" },
  { pattern: /\bbright|natural light/i, phrase: "Gauging natural light…" },
];
const GENERIC_QUERY_PHRASES = [
  "Scanning fresh listings…",
  "Cross-referencing photos and descriptions…",
  "Weighing what matters most to you…",
  "Narrowing down the shortlist…",
];
const PHRASE_CYCLE_MS = 1500;

function phrasesForQuery(query: string): string[] {
  const matched: string[] = [];
  for (const { pattern, phrase } of QUERY_PHRASE_RULES) {
    if (pattern.test(query) && !matched.includes(phrase)) matched.push(phrase);
  }
  if (matched.length === 0) return GENERIC_QUERY_PHRASES;
  const pool = [...matched];
  for (const g of GENERIC_QUERY_PHRASES) {
    if (pool.length >= 4) break;
    pool.push(g);
  }
  return pool;
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

export function SearchProgress({
  progress,
  query,
}: {
  progress: SearchProgressState;
  /** the raw query text, used only to pick relevant filler phrases below */
  query?: string;
}) {
  const { thinking, chars, startedAt, candidates, kept, model } = progress;

  // Only relevant before the first real progress event — cycle a phrase every
  // beat; reset (and re-derive the phrase set) whenever the query changes.
  const queryPhrases = useMemo(() => phrasesForQuery(query ?? ""), [query]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  // Reset the index when the query changes, following React's documented
  // "adjust state during render" pattern (comparing against state, not a ref)
  // rather than an effect — an effect would setState synchronously in its
  // body, which is flagged as a cascading-render risk.
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (phraseIndex !== 0) setPhraseIndex(0);
  }
  useEffect(() => {
    if (candidates != null) return; // real progress has arrived — stop cycling
    const id = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % queryPhrases.length);
    }, PHRASE_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [candidates, queryPhrases]);

  // Anthropic streams thinking_delta events in bursty, multi-word chunks —
  // per their own streaming docs, this "chunky" delivery (larger chunks
  // alternating with smaller token-by-token ones) is expected server-side
  // batching behavior, not something fixable upstream. Decouple network
  // arrival from on-screen reveal with a local typewriter buffer: advance
  // toward the latest text a few characters per animation-frame-rate tick
  // instead of snapping straight to whatever just arrived, so it always
  // reads as smooth individual characters. One persistent interval (not
  // recreated on every delta) reads the latest target via a ref; the catch-up
  // step scales with the backlog so a big burst still clears in ~200ms rather
  // than visibly lagging behind the next chunk.
  const thinkingRef = useRef(thinking);
  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);
  const [revealed, setRevealed] = useState("");
  const revealedRef = useRef("");
  useEffect(() => {
    const id = window.setInterval(() => {
      const target = thinkingRef.current;
      const cur = revealedRef.current;
      if (target.length < cur.length) {
        // A new search reset the text — snap back instead of "unrevealing".
        revealedRef.current = target;
        setRevealed(target);
        return;
      }
      if (cur.length >= target.length) return;
      const step = Math.max(1, Math.ceil((target.length - cur.length) / 12));
      const next = target.slice(0, cur.length + step);
      revealedRef.current = next;
      setRevealed(next);
    }, 16);
    return () => window.clearInterval(id);
  }, []);

  // Summarized thinking arrives in paragraph-sized chunks — present each as
  // its own thought instead of one accumulated wall.
  const paras = revealed.trim() ? revealed.trim().split(/\n{2,}/) : [];
  const stillThinking = chars === 0;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Keep the newest thought in view as it streams.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [revealed]);

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

      <div ref={bodyRef} className="panel-scroll mt-3 min-h-0 flex-1 overflow-y-auto pb-1">
        {paras.length > 0 ? (
          <div className="flex flex-col gap-3 border-l-2 border-line pl-3.5">
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
          <p
            key={model || kept != null || candidates != null ? "progress" : phraseIndex}
            className="shimmer-text animate-fade-in text-[12.5px] leading-relaxed"
          >
            {model && kept != null
              ? `Reading the ${kept} closest listings…`
              : kept != null
                ? `Shortlisted ${kept}${candidates ? ` of ${candidates}` : ""} listings…`
                : candidates != null
                  ? `Scanning ${candidates} listings…`
                  : queryPhrases[phraseIndex % queryPhrases.length]}
          </p>
        )}
      </div>
    </div>
  );
}
