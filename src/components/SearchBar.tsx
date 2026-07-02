"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/api-types";

/**
 * Minimal Web Speech API typings (not in lib.dom by default). Chrome exposes
 * webkitSpeechRecognition; Safari 14.1+ also uses the webkit-prefixed
 * constructor (behind Siri/Dictation being enabled), so the same path covers
 * both. Everything is feature-detected — no mic, no button.
 */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  0: SpeechAlternative;
  isFinal: boolean;
}
interface SpeechEvent {
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
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

const PLACEHOLDER =
  "Describe your ideal place — “studio with sunny bay windows within a 5-min walk to a park, in the Marina, in-unit laundry and hardwood floors”";

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
}) {
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    // Feature-detect after mount so the mic button doesn't cause an SSR/client
    // hydration mismatch (window is absent during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicSupported(getSpeechCtor() !== null);
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* Safari can throw if recognition never started */
      }
    };
  }, []);

  const toggleMic = () => {
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        setListening(false);
      }
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    // Safari is stricter than Chrome here: construction or start() can throw
    // (e.g. dictation disabled), and must happen inside this user gesture.
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
    <div className="flex flex-col gap-2.5 rounded-[26px] border border-white/60 bg-surface/75 px-3.5 pt-3 pb-2.5 shadow-2xl ring-1 ring-ink/5 backdrop-blur-xl">
      {/* The one big box */}
      <div
        className={`relative rounded-[22px] p-[1.5px] transition-shadow duration-300 ${
          searching
            ? "animate-glow bg-gradient-to-r from-accent/50 via-warn/40 to-accent/50"
            : "bg-gradient-to-r from-line via-line to-line focus-within:from-accent/45 focus-within:via-accent/25 focus-within:to-accent/45"
        }`}
      >
        <div className="relative rounded-[21px] bg-surface">
          <textarea
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDER}
            rows={2}
            className="w-full resize-none rounded-[21px] bg-transparent px-5 py-3.5 pr-32 text-[15px] leading-relaxed outline-none placeholder:text-faint/90"
          />
          <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1.5">
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                title={listening ? "Stop listening" : "Speak your search"}
                aria-label="Voice search"
                aria-pressed={listening}
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
                  listening
                    ? "animate-glow border-accent bg-accent text-white"
                    : "border-line bg-surface text-muted hover:border-accent/50 hover:text-accent"
                }`}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onSearch}
              disabled={searching || !query.trim()}
              className="flex h-10 items-center gap-1.5 rounded-full bg-gradient-to-b from-accent to-accent-deep px-5 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {searching ? (
                <>
                  <span className="flex items-end gap-[3px]" aria-hidden>
                    <span className="thinking-dot h-1 w-1 rounded-full bg-white" />
                    <span className="thinking-dot h-1 w-1 rounded-full bg-white" style={{ animationDelay: "0.15s" }} />
                    <span className="thinking-dot h-1 w-1 rounded-full bg-white" style={{ animationDelay: "0.3s" }} />
                  </span>
                  Matching
                </>
              ) : (
                <>
                  <span aria-hidden>✦</span> Search
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {locationStatus === "granted" && location ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-good/30 bg-good/10 px-2.5 py-1 text-good"
            title="Using your location as the search center"
          >
            📍 Near you
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestLocation}
            disabled={locationStatus === "prompting"}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-muted transition-colors hover:border-faint hover:text-ink"
            title={
              locationStatus === "denied"
                ? "Location was blocked — enable it in your browser to search by distance"
                : "Use your location to search within a radius"
            }
          >
            📍 {locationStatus === "prompting" ? "Locating…" : locationStatus === "denied" ? "Location blocked" : "Use my location"}
          </button>
        )}
        <label className="inline-flex items-center gap-1 text-faint">
          within
          <select
            value={radiusMi}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            disabled={locationStatus !== "granted"}
            className="rounded-full border border-line bg-surface px-2 py-1 text-[12px] text-muted outline-none focus:border-faint disabled:opacity-50"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r} mi
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onToggleHiddenGone}
          className={`rounded-full border px-2.5 py-1 transition-colors ${
            showHiddenGone
              ? "border-ink bg-ink text-paper"
              : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
          }`}
          title="Include hidden / not-a-fit / likely-unavailable listings"
        >
          Show hidden &amp; gone
        </button>
        {(hasSearch || query) && (
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-accent transition-colors hover:text-accent-deep"
          >
            Clear
          </button>
        )}
      </div>

      {searchError && (
        <p className="animate-fade-up rounded-xl border border-alert/25 bg-alert/8 px-3.5 py-2 text-[12.5px] text-alert">
          {searchError}
        </p>
      )}

      {hasSearch && !searchError && (
        <div className="animate-fade-up flex flex-col gap-1.5">
          {search!.interpretation && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              <span className="font-medium text-faint">Understood as</span>{" "}
              {search!.interpretation}
            </p>
          )}
          {search!.intentChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {search!.intentChips.map((chip, i) => (
                <span
                  key={chip}
                  className="animate-pop-in rounded-full border border-accent/25 bg-accent-soft/50 px-2.5 py-0.5 text-[11.5px] font-medium text-accent-deep"
                  style={{ animationDelay: `${i * 55}ms` }}
                >
                  {chip}
                </span>
              ))}
              <span className="self-center pl-1 text-[10.5px] text-faint">
                via {search!.model}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
