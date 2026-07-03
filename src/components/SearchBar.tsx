"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/api-types";

/** Web Speech API typings (webkit-prefixed; feature-detected). */
interface SpeechAlt { transcript: string }
interface SpeechResult { 0: SpeechAlt; isFinal: boolean }
interface SpeechEvent { results: ArrayLike<SpeechResult> }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type LocationStatus = "idle" | "prompting" | "granted" | "denied" | "unavailable";

const PLACEHOLDER = "Search apartments…";

/**
 * The app header: the brand mark and the search field are one bar. Everything
 * else (location, radius, hidden toggle, isolated-hood chip) was removed as
 * chrome — search runs SF-wide, and an isolated neighborhood is cleared by
 * clicking the map or pressing Escape.
 */
export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  onClear,
  searching,
  searchError,
  search,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onClear: () => void;
  searching: boolean;
  searchError: string | null;
  search: SearchResponse | null;
}) {
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicSupported(getSpeechCtor() !== null);
    return () => {
      try { recRef.current?.stop(); } catch { /* Safari may throw if never started */ }
    };
  }, []);

  const toggleMic = () => {
    if (listening) {
      try { recRef.current?.stop(); } catch { setListening(false); }
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      baseRef.current = query ? query.trimEnd() + " " : "";
      rec.onresult = (e) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        onQueryChange(baseRef.current + t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setMicSupported(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!searching && query.trim()) onSearch();
    }
  };

  const hasSearch = search != null;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface/92 shadow-[0_10px_34px_rgba(0,0,0,0.46)] backdrop-blur-md">
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* Brand wordmark */}
        <span
          className="shrink-0 text-[19px] leading-none font-bold tracking-[-0.02em] text-ink"
          style={{ fontFamily: "var(--font-brand)" }}
        >
          Apt.
        </span>

        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-faint">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER}
          rows={1}
          spellCheck={false}
          className="max-h-24 min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 text-[14px] leading-snug text-ink outline-none placeholder:text-faint"
        />
        {(hasSearch || query) && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-muted"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        {micSupported && (
          <button
            type="button"
            onClick={toggleMic}
            title={listening ? "Stop dictation" : "Dictate search"}
            aria-label="Voice search"
            aria-pressed={listening}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
              listening
                ? "soft-pulse bg-accent/15 text-accent"
                : "text-faint hover:bg-elevated hover:text-muted"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onSearch}
          disabled={searching || !query.trim()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-paper transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
        >
          {searching ? (
            <span className="flex items-end gap-[3px]" aria-hidden>
              <span className="thinking-dot h-1 w-1 rounded-full bg-paper" />
              <span className="thinking-dot h-1 w-1 rounded-full bg-paper" style={{ animationDelay: "0.15s" }} />
              <span className="thinking-dot h-1 w-1 rounded-full bg-paper" style={{ animationDelay: "0.3s" }} />
            </span>
          ) : (
            "Search"
          )}
        </button>
      </div>

      {searchError && (
        <p className="animate-fade-up border-t border-alert/25 bg-alert/8 px-3 py-1.5 text-[12px] text-alert">
          {searchError}
        </p>
      )}
    </div>
  );
}
