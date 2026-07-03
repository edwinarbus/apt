"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListingDetailResponse } from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import type { UserListingStatus } from "@/core/types";
import {
  fmtBaths,
  fmtBeds,
  fmtDate,
  fmtDateShort,
  fmtMoney,
  relativeTime,
} from "@/lib/format";
import { PhotoImg } from "./PhotoImg";

const EVENT_LABELS: Record<string, string> = {
  first_seen: "First seen",
  price_change: "Price change",
  content_change: "Content changed",
  stale_change: "Missing from source",
  listing_status_change: "Source status change",
  reappeared: "Reappeared",
};

export function ListingDetail({
  listingId,
  onClose,
  onStatusChange,
}: {
  listingId: string;
  onClose: () => void;
  onStatusChange: (id: string, status: UserListingStatus | null) => void;
}) {
  const [data, setData] = useState<ListingDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [savingStatus, setSavingStatus] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [closing, setClosing] = useState(false);
  // One-shot "Remembered" feedback that floats up off the thumbs-down button.
  // `tick` re-keys the element so a rapid re-click replays the animation.
  const [remembered, setRemembered] = useState({ on: false, tick: 0 });
  const rememberTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (rememberTimer.current) window.clearTimeout(rememberTimer.current);
  }, []);

  // Play a quick fade-out before unmounting so close is animated too.
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 150);
  }, [onClose]);

  useEffect(() => {
    fetch(`/api/listings/${listingId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json() as Promise<ListingDetailResponse>;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [listingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const setStatus = async (status: UserListingStatus | null) => {
    if (!data || savingStatus) return;
    const next = data.listing.userStatus === status ? null : status;
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const badges = computeBadges({
          firstSeenAt: data.listing.firstSeenAt,
          staleStatus: data.listing.staleStatus,
          scamRiskLevel: data.listing.scamRiskLevel,
          duplicateGroupId: data.listing.duplicateGroupId,
          userStatus: next,
          lastPriceChange: data.listing.lastPriceChange,
          sourceLastRunStatus: data.listing.sourceLastRunStatus,
        });
        setData({ ...data, listing: { ...data.listing, userStatus: next, badges } });
        onStatusChange(listingId, next);
      }
    } finally {
      setSavingStatus(false);
    }
  };

  // Thumbs-down: mark the apartment not-a-fit (drops it from results, like the
  // old Hide) AND remember its characteristics so Porter learns to steer away
  // from what recurs across your dislikes. Toggling off clears both.
  const toggleDislike = async () => {
    if (!data || savingStatus) return;
    const disliked = data.listing.userStatus !== "not_a_fit";
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/dislike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disliked }),
      });
      if (res.ok) {
        const next: UserListingStatus | null = disliked ? "not_a_fit" : null;
        const badges = computeBadges({
          firstSeenAt: data.listing.firstSeenAt,
          staleStatus: data.listing.staleStatus,
          scamRiskLevel: data.listing.scamRiskLevel,
          duplicateGroupId: data.listing.duplicateGroupId,
          userStatus: next,
          lastPriceChange: data.listing.lastPriceChange,
          sourceLastRunStatus: data.listing.sourceLastRunStatus,
        });
        setData({ ...data, listing: { ...data.listing, userStatus: next, badges } });
        onStatusChange(listingId, next);
        if (disliked) {
          setRemembered((r) => ({ on: true, tick: r.tick + 1 }));
          if (rememberTimer.current) window.clearTimeout(rememberTimer.current);
          rememberTimer.current = window.setTimeout(
            () => setRemembered((r) => ({ ...r, on: false })),
            1000,
          );
        }
      }
    } finally {
      setSavingStatus(false);
    }
  };

  const l = data?.listing;
  const photos = l?.photos ?? [];

  // A few essential facts — only the ones actually known.
  const facts: Array<{ label: string; value: string }> = [];
  if (l) {
    if (l.availableDate) facts.push({ label: "Available", value: fmtDate(l.availableDate) });
    const laundry =
      l.laundryNormalized && l.laundryNormalized !== "unknown"
        ? l.laundryNormalized.replaceAll("_", " ")
        : null;
    if (laundry) facts.push({ label: "Laundry", value: laundry });
    const parking =
      l.parkingNormalized && l.parkingNormalized !== "unknown"
        ? l.parkingNormalized.replaceAll("_", " ")
        : null;
    if (parking) facts.push({ label: "Parking", value: parking });
    const pets =
      l.catsAllowed || l.dogsAllowed
        ? [l.catsAllowed ? "cats" : null, l.dogsAllowed ? "dogs" : null].filter(Boolean).join(" & ") + " ok"
        : l.catsAllowed === false && l.dogsAllowed === false
          ? "no pets"
          : null;
    if (pets) facts.push({ label: "Pets", value: pets });
    const deposit = l.depositRaw ?? (l.depositAmount != null ? fmtMoney(l.depositAmount) : null);
    if (deposit) facts.push({ label: "Deposit", value: deposit });
  }

  const disliked = l?.userStatus === "not_a_fit";
  const specs = l
    ? [fmtBeds(l.bedrooms), fmtBaths(l.bathrooms), l.squareFeet ? `${l.squareFeet.toLocaleString()} sqft` : null]
        .filter(Boolean)
        .join(" · ")
    : "";
  const place = l
    ? [l.addressRaw, l.neighborhood ?? l.sourceNeighborhoodRaw].filter(Boolean).join(" · ")
    : "";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] ${
        closing ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
      onClick={requestClose}
    >
      <div
        className={`flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.6)] ${
          closing ? "animate-modal-out" : "animate-modal-in"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
          {error && <p className="p-8 text-center text-alert">{error}</p>}
          {!data && !error && <p className="p-10 text-center text-sm text-faint">Loading…</p>}
          {l && (
            <>
              {/* Gallery */}
              <div className="relative">
                <PhotoImg
                  src={photos[photoIndex] ?? l.primaryPhotoUrl}
                  alt={l.title}
                  className="h-[240px] w-full object-cover"
                />
                <button
                  type="button"
                  onClick={requestClose}
                  className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-paper/70 text-[14px] text-muted backdrop-blur transition-colors hover:text-ink"
                  aria-label="Close"
                >
                  ✕
                </button>
                {photos.length > 1 && (
                  <div className="absolute right-0 bottom-0 left-0 flex gap-1.5 overflow-x-auto bg-gradient-to-t from-black/60 to-transparent p-2.5">
                    {photos.slice(0, 12).map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPhotoIndex(i)}
                        className={`h-11 w-14 shrink-0 overflow-hidden rounded border-2 ${
                          i === photoIndex ? "border-white" : "border-transparent opacity-70"
                        }`}
                      >
                        <PhotoImg src={p} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 p-5">
                {/* 1 — What is it */}
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[27px] leading-none font-bold tracking-tight text-ink tabular-nums">
                      {fmtMoney(l.priceEffectiveMonthly ?? l.priceMonthly)}
                    </span>
                    <span className="text-[14px] text-faint">/mo</span>
                    {l.priceEffectiveMonthly != null &&
                      l.priceMonthly != null &&
                      l.priceEffectiveMonthly < l.priceMonthly && (
                        <span className="text-[12px] text-faint line-through tabular-nums">
                          {fmtMoney(l.priceMonthly)}
                        </span>
                      )}
                  </div>
                  <p className="mt-1.5 text-[14px] font-medium text-ink">{specs || l.title}</p>
                  {place && <p className="mt-0.5 truncate text-[13px] text-muted">{place}</p>}
                  <p className="mt-0.5 text-[12px] text-faint">
                    {l.sourceName} · checked {relativeTime(l.lastSeenAt)}
                  </p>
                </div>

                {/* 2 — Worth opening: the editorial brief (full, not clamped) */}
                {data.enrichment?.summary && (
                  <p className="text-[13.5px] leading-relaxed text-muted">
                    {data.enrichment.summary}
                  </p>
                )}

                {/* Primary CTA */}
                <div className="flex flex-col gap-2">
                  <a
                    href={l.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-accent px-4 py-2.5 text-center text-[13.5px] font-semibold text-paper transition-colors hover:bg-accent-deep"
                  >
                    View original listing ↗
                  </a>

                  {/* Save + thumbs-down — the two prominent verdicts */}
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      disabled={savingStatus}
                      onClick={() => setStatus("saved")}
                      aria-pressed={l.userStatus === "saved"}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-4 py-2.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50 ${
                        l.userStatus === "saved"
                          ? "border-saved bg-saved/15 text-saved"
                          : "border-line-strong bg-elevated/60 text-ink hover:border-saved/50 hover:text-saved"
                      }`}
                    >
                      <span aria-hidden>{l.userStatus === "saved" ? "★" : "☆"}</span>
                      {l.userStatus === "saved" ? "Saved" : "Save"}
                    </button>
                    <div className="relative flex flex-1">
                      <button
                        type="button"
                        disabled={savingStatus}
                        onClick={toggleDislike}
                        aria-pressed={disliked}
                        aria-label={disliked ? "Remove not-a-fit" : "Not a fit — remember to skip these"}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-4 py-2.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50 ${
                          disliked
                            ? "border-warn/50 bg-warn/10 text-warn"
                            : "border-line-strong bg-elevated/60 text-muted hover:border-warn/50 hover:text-warn"
                        }`}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill={disliked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10Z" />
                          <path d="M17 2h2.67A1.33 1.33 0 0 1 21 3.33v8.34A1.33 1.33 0 0 1 19.67 13H17" />
                        </svg>
                        Not a fit
                      </button>
                      {remembered.on && (
                        <span
                          key={remembered.tick}
                          className="animate-remember pointer-events-none absolute bottom-full left-1/2 mb-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-semibold text-paper shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
                        >
                          Remembered
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Essential facts */}
                {facts.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                    {facts.map((f) => (
                      <span key={f.label} className="text-muted">
                        <span className="text-faint">{f.label} </span>
                        <span className="text-ink capitalize">{f.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Progressive disclosure */}
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="flex items-center gap-1 self-start text-[13px] font-medium text-accent transition-colors hover:text-accent-deep"
                >
                  {showAll ? "Hide details" : "More details"}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={`transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {showAll && (
                  <div className="flex flex-col gap-5 border-t border-line pt-4">
                    {l.description && (
                      <Section title="Description">
                        <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink/85">
                          {l.description}
                        </p>
                      </Section>
                    )}

                    {/* Risk signals — kept; the rest of the AI notes are dropped. */}
                    {data.enrichment && data.enrichment.riskReasons.length > 0 && (
                      <Section title="Risk signals">
                        <ul className="list-disc pl-4 text-[12.5px] leading-relaxed text-warn/90">
                          {data.enrichment.riskReasons.map((it) => (
                            <li key={it}>{it}</li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {l.scamWarnings.length > 0 && (
                      <Section title="Suspicious signals">
                        <p className="text-[12.5px] text-muted">
                          {l.scamWarnings.map((w) => w.replaceAll("_", " ")).join(" · ")}
                        </p>
                        <p className="mt-1 text-[11px] text-faint">Heuristic signals, not conclusions.</p>
                      </Section>
                    )}

                    {/* Extra terms not already shown up top. */}
                    {(l.leaseTermRaw ||
                      l.applicationFeeRaw ||
                      l.brokerFeeRaw ||
                      l.utilitiesIncluded.length > 0 ||
                      l.pricePerSquareFoot != null ||
                      l.concessionsRaw) && (
                      <Section title="Terms">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                          {l.leaseTermRaw && <Fact label="Lease" value={l.leaseTermRaw} />}
                          {l.applicationFeeRaw && <Fact label="App fee" value={l.applicationFeeRaw} />}
                          {l.brokerFeeRaw && <Fact label="Broker fee" value={l.brokerFeeRaw} />}
                          {l.utilitiesIncluded.length > 0 && (
                            <Fact label="Utilities" value={l.utilitiesIncluded.join(", ")} />
                          )}
                          {l.pricePerSquareFoot != null && (
                            <Fact label="$/sqft" value={`$${l.pricePerSquareFoot}`} />
                          )}
                          {l.concessionsRaw && <Fact label="Concessions" value={l.concessionsRaw} highlight />}
                        </div>
                      </Section>
                    )}

                    {data.priceHistory.length > 1 && (
                      <Section title="Price history">
                        <ul className="flex flex-col gap-0.5">
                          {data.priceHistory.map((h, i) => (
                            <li key={h.observedAt + i} className="flex gap-3 text-[12.5px]">
                              <span className="w-16 shrink-0 text-faint">{fmtDateShort(h.observedAt)}</span>
                              <span className={i === 0 ? "font-medium text-ink" : "text-muted"}>
                                {h.priceMonthly != null ? fmtMoney(h.priceMonthly) : (h.priceRaw ?? "—")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {data.duplicates.length > 0 && (
                      <Section title="Possible duplicates">
                        <ul className="flex flex-col gap-1">
                          {data.duplicates.map((d) => (
                            <li key={d.id} className="text-[12.5px] text-muted">
                              <a href={d.originalUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                {d.title}
                              </a>{" "}
                              — {fmtMoney(d.priceMonthly)} on {d.sourceName}
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {data.events.length > 0 && (
                      <Section title="History">
                        <ul className="flex flex-col gap-0.5">
                          {data.events.slice(0, 10).map((e) => (
                            <li key={e.id} className="flex gap-3 text-[12.5px]">
                              <span className="w-16 shrink-0 text-faint">{fmtDateShort(e.createdAt)}</span>
                              <span className="text-muted">{EVENT_LABELS[e.eventType] ?? e.eventType}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    <Section title="Source & contact">
                      <p className="text-[12.5px] text-muted">
                        {l.sourceName}
                        {(l.contactPhone || l.contactEmail) && (
                          <> · {[l.contactPhone, l.contactEmail].filter(Boolean).join(" · ")}</>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-faint">
                        First seen {fmtDate(l.firstSeenAt)} · last seen {relativeTime(l.lastSeenAt)}
                      </p>
                    </Section>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h3>
      {children}
    </div>
  );
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-faint">{label}</div>
      <div className={`text-[13px] font-medium capitalize ${highlight ? "text-good" : "text-ink"}`}>{value}</div>
    </div>
  );
}
