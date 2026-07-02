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
const PLACEHOLDER = "1BR under $3,200 · dog-friendly · in-unit laundry · Lower Haight";

function Crosshair({ className = "" }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface/95 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      {/* Command line */}
      <div
        className={`flex items-start gap-2 border-b px-2.5 py-2 transition-colors ${
          searching ? "border-accent/40" : "border-transparent focus-within:border-line"
        }`}
      >
        <span
          aria-hidden
          className={`mt-[7px] font-mono text-[13px] leading-none ${searching ? "scan-text" : "text-accent"}`}
        >
          ›
        </span>
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER}
          rows={1}
          spellCheck={false}
          className="max-h-24 min-h-[22px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-snug text-ink outline-none placeholder:text-faint"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              title={listening ? "Stop dictation" : "Dictate search"}
              aria-label="Voice search"
              aria-pressed={listening}
              className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
                listening
                  ? "soft-pulse border-accent bg-accent/12 text-accent"
                  : "border-line text-faint hover:border-line-strong hover:text-muted"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onSearch}
            disabled={searching || !query.trim()}
            className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-paper uppercase transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
          >
            {searching ? (
              <span className="flex items-end gap-[2px]" aria-hidden>
                <span className="thinking-dot h-[3px] w-[3px] rounded-full bg-paper" />
                <span className="thinking-dot h-[3px] w-[3px] rounded-full bg-paper" style={{ animationDelay: "0.15s" }} />
                <span className="thinking-dot h-[3px] w-[3px] rounded-full bg-paper" style={{ animationDelay: "0.3s" }} />
              </span>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      {/* Status / controls line — mono, tactical */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.04em]">
        {selectedHood && (
          <button
            type="button"
            onClick={onClearHood}
            className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-semibold tracking-[0.1em] text-accent uppercase transition-colors hover:bg-accent/20"
            title="Isolated neighborhood — clear"
          >
            ▣ {selectedHood} <span aria-hidden className="text-accent/70">✕</span>
          </button>
        )}
        {locGranted ? (
          <span className="inline-flex items-center gap-1.5 text-good" title="Search anchored to your location">
            <Crosshair /> LOCK
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestLocation}
            disabled={locationStatus === "prompting"}
            className="inline-flex items-center gap-1.5 text-faint transition-colors hover:text-muted"
            title={locationStatus === "denied" ? "Location blocked — using SF centerpoint" : "Anchor search to your location"}
          >
            <Crosshair />
            {locationStatus === "prompting" ? "LOCATING" : locationStatus === "denied" ? "SF CENTER" : "SET LOCATION"}
          </button>
        )}
        <label className="inline-flex items-center gap-1 text-faint">
          <span>R</span>
          <select
            value={radiusMi}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            disabled={!locGranted}
            className="rounded-sm border border-line bg-elevated px-1 py-0.5 text-muted outline-none focus:border-line-strong disabled:opacity-40"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>{r}mi</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onToggleHiddenGone}
          aria-pressed={showHiddenGone}
          className={`rounded-sm border px-1.5 py-0.5 tracking-[0.08em] uppercase transition-colors ${
            showHiddenGone
              ? "border-line-strong bg-elevated text-ink"
              : "border-line text-faint hover:text-muted"
          }`}
          title="Include hidden / not-a-fit / likely-unavailable"
        >
          Hidden+Gone
        </button>
        {(hasSearch || query) && (
          <button
            type="button"
            onClick={onClear}
            className="tracking-[0.06em] text-accent uppercase transition-colors hover:text-accent-deep"
          >
            Clear
          </button>
        )}
        <span className="ml-auto hidden text-faint/70 sm:inline">↵ run · ⇧↵ line</span>
      </div>

      {searchError && (
        <p className="animate-fade-up border-t border-alert/25 bg-alert/8 px-2.5 py-1.5 text-[11.5px] text-alert">
          {searchError}
        </p>
      )}

      {hasSearch && !searchError && (
        <div className="animate-fade-up flex flex-col gap-1.5 border-t border-line px-2.5 py-2">
          {search!.interpretation && (
            <p className="text-[11.5px] leading-relaxed text-muted">
              <span className="font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">Parsed</span>{" "}
              {search!.interpretation}
            </p>
          )}
          {search!.intentChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {search!.intentChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-sm border border-line-strong bg-elevated px-1.5 py-0.5 font-mono text-[10px] tracking-[0.02em] text-muted"
                >
                  {chip}
                </span>
              ))}
              <span className="pl-1 font-mono text-[9.5px] tracking-[0.08em] text-faint/70">
                {search!.model}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
