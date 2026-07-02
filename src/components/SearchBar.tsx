"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/api-types";

/** Minimal Web Speech API typings (not in lib.dom by default; webkit-prefixed). */
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
  "Describe your ideal place — e.g. “studio with sunny bay windows within a 5-min walk to a park, in the Marina, in-unit laundry and hardwood floors”";

export function SearchBar({
  query,
  onQueryChange,
  onSearch,
  onClear,
  searching,
  searchError,
  search,
  resultCount,
  totalCount,
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
  resultCount: number;
  totalCount: number;
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
    return () => recRef.current?.stop();
  }, []);

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
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
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!searching && query.trim()) onSearch();
    }
  };

  const hasSearch = search != null;

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface/80 px-4 py-3">
      <div className="relative">
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER}
          rows={2}
          className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 pr-28 text-[15px] leading-relaxed outline-none placeholder:text-faint focus:border-accent/60"
        />
        <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              title={listening ? "Stop listening" : "Speak your search"}
              aria-label="Voice search"
              className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                listening
                  ? "animate-pulse border-alert bg-alert/10 text-alert"
                  : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
              }`}
            >
              {/* microphone glyph */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onSearch}
            disabled={searching || !query.trim()}
            className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition hover:bg-accent-deep disabled:opacity-40"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

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
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-muted hover:border-faint hover:text-ink"
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
            className="font-medium text-accent hover:text-accent-deep"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-faint">
          {searching
            ? "Searching…"
            : hasSearch
              ? `${resultCount} match${resultCount === 1 ? "" : "es"} of ${search!.candidateCount} searched`
              : `${totalCount} listings`}
        </span>
      </div>

      {searchError && (
        <p className="rounded-lg border border-alert/25 bg-alert/8 px-3 py-2 text-[12.5px] text-alert">
          {searchError}
        </p>
      )}

      {hasSearch && !searchError && (
        <div className="flex flex-col gap-1.5">
          {search!.interpretation && (
            <p className="text-[12.5px] text-muted">
              <span className="text-faint">Understood as:</span> {search!.interpretation}
            </p>
          )}
          {search!.intentChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {search!.intentChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-accent/20 bg-accent-soft/40 px-2.5 py-0.5 text-[11.5px] text-ink/80"
                >
                  {chip}
                </span>
              ))}
              <span className="self-center text-[10.5px] text-faint">via {search!.model}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
