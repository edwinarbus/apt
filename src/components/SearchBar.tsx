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

const RADII = [1, 2, 5, 10, 25];
const PLACEHOLDER = "Search apartments — try “studios near Japantown”";

export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  onClear,
  searching,
  searchError,
  search,
  location,
  locationStatus,
  onRequestLocation,
  radiusMi,
  onRadiusChange,
  showHiddenGone,
  onToggleHiddenGone,
  selectedHood,
  onClearHood,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onClear: () => void;
  searching: boolean;
  searchError: string | null;
  search: SearchResponse | null;
  location: { lat: number; lng: number } | null;
  locationStatus: LocationStatus;
  onRequestLocation: () => void;
  radiusMi: number;
  onRadiusChange: (mi: number) => void;
  showHiddenGone: boolean;
  onToggleHiddenGone: () => void;
  selectedHood: string | null;
  onClearHood: () => void;
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
  const locGranted = locationStatus === "granted" && location != null;
  const locLabel =
    locationStatus === "prompting" ? "Locating…"
    : locGranted ? "Near you"
    : locationStatus === "denied" ? "SF center"
    : "Use location";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface/95 shadow-[0_8px_28px_rgba(0,0,0,0.4)]">
      {/* Primary input */}
      <div className="flex items-center gap-2 px-2.5 py-2">
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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-2.5 py-1.5 text-[12px] text-muted">
        <button
          type="button"
          onClick={onRequestLocation}
          disabled={locationStatus === "prompting"}
          className={`inline-flex items-center gap-1.5 transition-colors ${
            locGranted ? "text-ink" : "hover:text-ink"
          }`}
          title={locGranted ? "Search anchored near you" : "Anchor search to your location"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 21c4-4.5 7-8 7-11a7 7 0 1 0-14 0c0 3 3 6.5 7 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          {locLabel}
        </button>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-faint">Radius</span>
          <select
            value={radiusMi}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            disabled={!locGranted}
            className="rounded border border-line bg-elevated px-1.5 py-0.5 text-ink outline-none focus:border-line-strong disabled:opacity-40"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>{r} mi</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onToggleHiddenGone}
          aria-pressed={showHiddenGone}
          className={`transition-colors ${showHiddenGone ? "text-ink" : "text-muted hover:text-ink"}`}
          title="Include hidden, not-a-fit, and likely-unavailable listings"
        >
          {showHiddenGone ? "✓ " : ""}Show hidden
        </button>
        {selectedHood && (
          <button
            type="button"
            onClick={onClearHood}
            className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/15"
            title="Clear isolated neighborhood"
          >
            {selectedHood}
            <span aria-hidden className="text-accent/70">✕</span>
          </button>
        )}
        {(hasSearch || query) && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-faint transition-colors hover:text-muted"
          >
            Clear
          </button>
        )}
      </div>

      {searchError && (
        <p className="animate-fade-up border-t border-alert/25 bg-alert/8 px-2.5 py-1.5 text-[12px] text-alert">
          {searchError}
        </p>
      )}

      {/* Parsed filters — clean chips, no model/prose. */}
      {hasSearch && !searchError && search!.intentChips.length > 0 && (
        <div className="animate-fade-up flex flex-wrap items-center gap-1 border-t border-line px-2.5 py-2">
          {search!.intentChips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-line-strong bg-elevated px-1.5 py-0.5 text-[11.5px] text-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
