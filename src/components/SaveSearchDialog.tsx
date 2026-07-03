"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Save the current search so the overnight Apt Scout watches for new matches.
 * Optionally arm "auto-apply" — the agent DRAFTS an application for each new
 * match (it never sends; the draft is staged for the user to review).
 */
export function SaveSearchDialog({
  query,
  interpretation,
  matchCount,
  onClose,
  onConfirm,
}: {
  query: string;
  interpretation?: string | null;
  matchCount: number;
  onClose: () => void;
  onConfirm: (opts: { name: string; autoApply: boolean }) => Promise<void>;
}) {
  // Prefer the user's own phrasing as the name; fall back to the model's
  // interpretation only when there's no query text.
  const [name, setName] = useState(() => query.trim() || interpretation?.trim() || "");
  const [autoApply, setAutoApply] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    nameRef.current?.focus();
    nameRef.current?.select();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ name: name.trim(), autoApply });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="animate-rise-in flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line bg-gradient-to-b from-accent-soft/40 to-transparent px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 3h14a1 1 0 0 1 1 1v16l-8-5-8 5V4a1 1 0 0 1 1-1Z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-ink">Put this search on Autopilot</h2>
            <p className="text-[12.5px] text-muted">
              Autopilot checks every night and applies to new matches for you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. Sunny 1BR near the park"
              className="rounded-md border border-line bg-elevated px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
            />
            {query && (
              <span className="truncate text-[11.5px] text-faint">
                From your search: “{query}”
              </span>
            )}
          </label>

          {/* Auto-apply */}
          <button
            type="button"
            onClick={() => setAutoApply((v) => !v)}
            aria-pressed={autoApply}
            className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
              autoApply ? "border-accent/50 bg-accent-soft/40" : "border-line hover:border-line-strong"
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                autoApply ? "bg-accent" : "bg-line-strong"
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white transition-transform ${
                  autoApply ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">
                Auto-apply to new matches
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                Autopilot writes an application for every new match, ready in your queue.
                <span className="text-faint"> Send it in one tap.</span>
              </span>
            </span>
          </button>

          {error && (
            <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-[12px] text-alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[12px] text-faint">
            {matchCount > 0 ? `${matchCount} listing${matchCount === 1 ? "" : "s"} match now` : "Watches for future matches"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-line px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !name.trim()}
              className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint"
            >
              {saving ? "Saving…" : autoApply ? "Save & auto-apply" : "Save search"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
