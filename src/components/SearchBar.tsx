"use client";

import { useEffect, useRef } from "react";
import type { SearchResponse } from "@/lib/api-types";

const PLACEHOLDER = "Search…";
// Cap the auto-grow at two lines of the 13px text (line box ≈ 18px) plus the
// field's own vertical padding; a longer query scrolls within those two lines.
const TWO_LINE_MAX_PX = 48;

/**
 * The app header: the brand mark and the search field are one bar. There's no
 * search button — Enter submits (the iOS keyboard shows a "Search" return key
 * via enterKeyHint), and the field grows to a second line for long queries.
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
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow the field to fit its content, up to two lines (see TWO_LINE_MAX_PX).
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TWO_LINE_MAX_PX)}px`;
  }, [query]);

  // "/" focuses the search from anywhere (unless already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      fieldRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Latest submit closure, read by the beforeinput listener below (which is
  // attached once) so it always sees the current query/searching.
  const submitRef = useRef(() => {});
  useEffect(() => {
    submitRef.current = () => {
      if (!searching && query.trim()) onSearch();
    };
  }, [searching, query, onSearch]);

  // Enter submits. On iOS Safari, preventDefault on `keydown` does NOT stop a
  // textarea from inserting a newline — the line break lands first and only a
  // second Return "sends". `beforeinput`'s insertLineBreak IS cancelable there,
  // so intercept that instead: block the newline and submit. It fires for Enter
  // on desktop too, so it's the single, reliable submit path.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const onBeforeInput = (e: Event) => {
      if ((e as InputEvent).inputType === "insertLineBreak") {
        e.preventDefault();
        submitRef.current();
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  const hasSearch = search != null;

  return (
    <div className="textured overflow-hidden rounded-xl border-2 border-white/30 bg-panel/98 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_18px_45px_-8px_rgba(0,0,0,0.9),0_5px_16px_-3px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* Brand wordmark */}
        <span
          className="shrink-0 text-[19px] leading-none font-bold tracking-[-0.02em] text-ink"
          style={{ fontFamily: "var(--font-brand)" }}
        >
          Apt.
        </span>

        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />

        <textarea
          ref={fieldRef}
          value={query}
          // Collapse any newline (e.g. from a paste, or a stray line break that
          // slipped past beforeinput) to a space — this is a one-line query.
          onChange={(e) => onQueryChange(e.target.value.replace(/\r?\n/g, " "))}
          placeholder={PLACEHOLDER}
          rows={1}
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Search apartments"
          className="min-h-[24px] flex-1 resize-none self-center overflow-y-auto bg-transparent py-1 text-[13px] leading-snug text-ink outline-none placeholder:text-faint"
        />

        {searching ? (
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-none"
          />
        ) : (
          (hasSearch || query) && (
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
          )
        )}
      </div>

      {searchError && (
        <p className="animate-fade-up border-t border-alert/25 bg-alert/8 px-3 py-1.5 text-[12px] text-alert">
          {searchError}
        </p>
      )}
    </div>
  );
}
