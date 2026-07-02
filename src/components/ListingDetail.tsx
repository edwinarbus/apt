"use client";

import { useEffect, useState } from "react";
import type { ListingDetailResponse } from "@/lib/api-types";
import { computeBadges } from "@/lib/badges";
import type { UserListingStatus } from "@/core/types";
import {
  fmtBaths,
  fmtBeds,
  fmtDate,
  fmtDateShort,
  fmtMoney,
  PRECISION_LABELS,
  relativeTime,
} from "@/lib/format";
import { BadgeRow } from "./Badges";
import { PhotoImg } from "./PhotoImg";

const STATUS_ACTIONS: Array<{ status: UserListingStatus; label: string }> = [
  { status: "saved", label: "★ Save" },
  { status: "maybe", label: "Maybe" },
  { status: "contacted", label: "Contacted" },
  { status: "toured", label: "Toured" },
  { status: "applied", label: "Applied" },
  { status: "not_a_fit", label: "Not a fit" },
  { status: "hidden", label: "Hide" },
  { status: "suspicious", label: "Suspicious" },
];

const EVENT_LABELS: Record<string, string> = {
  first_seen: "First seen",
  price_change: "Price change",
  content_change: "Listing content changed",
  stale_change: "Missing from source",
  listing_status_change: "Source status change",
  reappeared: "Reappeared on source",
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

  // Parent renders this component with key={listingId}, so state resets
  // naturally when the selected listing changes.
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setStatus = async (status: UserListingStatus) => {
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
        setData({
          ...data,
          listing: { ...data.listing, userStatus: next, badges },
        });
        onStatusChange(listingId, next);
      }
    } finally {
      setSavingStatus(false);
    }
  };

  const l = data?.listing;
  const photos = l?.photos ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[93vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
          {error && <p className="p-8 text-center text-alert">{error}</p>}
          {!data && !error && (
            <p className="p-8 text-center text-sm text-faint">Loading…</p>
          )}
          {l && (
            <>
              {/* Gallery */}
              <div className="relative">
                <PhotoImg
                  src={photos[photoIndex] ?? l.primaryPhotoUrl}
                  alt={l.title}
                  className="h-[300px] w-full object-cover"
                />
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-paper backdrop-blur transition hover:bg-ink"
                  aria-label="Close"
                >
                  ✕
                </button>
                {photos.length > 1 && (
                  <div className="absolute right-0 bottom-0 left-0 flex gap-1.5 overflow-x-auto bg-gradient-to-t from-ink/50 to-transparent p-2.5">
                    {photos.slice(0, 12).map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPhotoIndex(i)}
                        className={`h-12 w-16 shrink-0 overflow-hidden rounded-md border-2 ${
                          i === photoIndex ? "border-paper" : "border-transparent opacity-75"
                        }`}
                      >
                        <PhotoImg src={p} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-5 p-6">
                {/* Header */}
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-[26px] font-semibold tracking-tight">
                      {fmtMoney(l.priceMonthly)}
                      <span className="ml-1 text-sm font-normal text-faint">/mo</span>
                    </span>
                    {l.priceEffectiveMonthly != null &&
                      l.priceMonthly != null &&
                      l.priceEffectiveMonthly !== l.priceMonthly && (
                        <span className="text-sm font-medium text-good">
                          {fmtMoney(l.priceEffectiveMonthly)}/mo effective
                        </span>
                      )}
                    {l.lastPriceChange && (
                      <span className="text-[12px] text-muted">
                        was {fmtMoney(l.lastPriceChange.oldPrice)} ·{" "}
                        {relativeTime(l.lastPriceChange.at)}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-[17px] leading-snug font-semibold">{l.title}</h2>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {[
                      l.propertyName,
                      l.addressRaw
                        ? `${l.addressRaw}${l.unitNumberPublic ? ` #${l.unitNumberPublic}` : ""}`
                        : null,
                      l.neighborhood ?? l.sourceNeighborhoodRaw,
                      "San Francisco",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    <span className="text-faint"> · {PRECISION_LABELS[l.geocodePrecision]}</span>
                  </p>
                  <div className="mt-2">
                    <BadgeRow badges={l.badges} max={8} />
                  </div>
                </div>

                {/* User actions */}
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_ACTIONS.map(({ status, label }) => (
                    <button
                      key={status}
                      type="button"
                      disabled={savingStatus}
                      onClick={() => setStatus(status)}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                        l.userStatus === status
                          ? "border-ink bg-ink text-paper"
                          : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {l.userNote && (
                    <span className="self-center text-[12px] text-muted italic">
                      “{l.userNote}”
                    </span>
                  )}
                </div>

                {/* Verification reminder */}
                <div className="rounded-xl border border-warn/25 bg-warn/8 px-4 py-3 text-[13px] leading-relaxed">
                  <p className="font-medium text-warn">Verify before acting</p>
                  <p className="mt-0.5 text-muted">
                    Data was scraped from {l.sourceName} and may lag or parse imperfectly.
                    Confirm availability, rent, fees, deposits, pet policy, and terms on the{" "}
                    <a
                      href={l.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent underline decoration-accent/40 hover:text-accent-deep"
                    >
                      original listing
                    </a>{" "}
                    before contacting or paying anyone. Last checked{" "}
                    {relativeTime(l.lastSeenAt)}; latest source run:{" "}
                    {l.sourceLastRunStatus ?? "unknown"}.
                  </p>
                </div>

                {/* Suspicious signals */}
                {l.scamWarnings.length > 0 && (
                  <div className="rounded-xl border border-alert/25 bg-alert/8 px-4 py-3 text-[13px]">
                    <p className="font-medium text-alert">
                      Suspicious signals — verify carefully
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-muted">
                      {l.scamWarnings.map((w) => (
                        <li key={w}>{w.replaceAll("_", " ")}</li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[12px] text-faint">
                      These are heuristic signals, not conclusions.
                    </p>
                  </div>
                )}

                {/* AI notes (optional enrichment) */}
                {data.enrichment && (
                  <div className="rounded-xl border border-accent/20 bg-accent-soft/40 px-4 py-3.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <SectionTitle>✦ AI notes</SectionTitle>
                      <span className="text-[10.5px] text-faint">
                        {data.enrichment.model} · {relativeTime(data.enrichment.enrichedAt)}
                      </span>
                    </div>
                    {data.enrichment.summary && (
                      <p className="text-[13.5px] leading-relaxed text-ink/90">
                        {data.enrichment.summary}
                      </p>
                    )}
                    {data.enrichment.verifyBeforeContacting.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">
                          Verify before contacting
                        </p>
                        <ul className="mt-0.5 list-disc pl-5 text-[12.5px] text-muted">
                          {data.enrichment.verifyBeforeContacting.map((v) => (
                            <li key={v}>{v}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {data.enrichment.questionsForLandlord.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">
                          Questions to ask
                        </p>
                        <ul className="mt-0.5 list-disc pl-5 text-[12.5px] text-muted">
                          {data.enrichment.questionsForLandlord.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {data.enrichment.riskReasons.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[11px] font-semibold tracking-wide text-warn uppercase">
                          AI risk signals ({data.enrichment.aiRiskLevel ?? "unknown"})
                        </p>
                        <ul className="mt-0.5 list-disc pl-5 text-[12.5px] text-muted">
                          {data.enrichment.riskReasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-2.5 text-[11px] text-faint">
                      AI-generated from the listing text — may be wrong or incomplete. Not a
                      substitute for verifying with the original listing.
                    </p>
                  </div>
                )}

                {/* What the photos show (optional vision) */}
                {data.vision && (
                  <div className="rounded-xl border border-accent/20 bg-accent-soft/40 px-4 py-3.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <SectionTitle>✦ What the photos show</SectionTitle>
                      <span className="text-[10.5px] text-faint">
                        {data.vision.model} · {data.vision.imageCount} photo
                        {data.vision.imageCount === 1 ? "" : "s"} ·{" "}
                        {relativeTime(data.vision.analyzedAt)}
                      </span>
                    </div>
                    {data.vision.visualSummary && (
                      <p className="text-[13.5px] leading-relaxed text-ink/90">
                        {data.vision.visualSummary}
                      </p>
                    )}
                    {data.vision.features.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {data.vision.features.map((f) => (
                          <span
                            key={f}
                            className="rounded-full border border-accent/20 bg-surface px-2.5 py-1 text-[12px] text-ink/80"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {data.vision.rooms.length > 0 && (
                      <ul className="mt-2.5 flex flex-col gap-0.5 text-[12.5px] text-muted">
                        {data.vision.rooms.map((r) => (
                          <li key={r.room}>
                            <span className="font-medium text-ink/80 capitalize">{r.room}:</span>{" "}
                            {r.details}
                          </li>
                        ))}
                      </ul>
                    )}
                    {((data.vision.condition && data.vision.condition !== "unknown") ||
                      data.vision.notes) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                        {data.vision.condition && data.vision.condition !== "unknown" && (
                          <span className="rounded-full bg-line/50 px-2 py-0.5 text-muted capitalize">
                            {data.vision.condition}
                          </span>
                        )}
                        {data.vision.notes && <span className="italic">{data.vision.notes}</span>}
                      </div>
                    )}
                    <p className="mt-2.5 text-[11px] text-faint">
                      AI-detected from the listing photos — may be wrong or incomplete. Verify
                      against the actual photos and the original listing.
                    </p>
                  </div>
                )}

                {/* Facts */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
                  <Fact label="Beds" value={fmtBeds(l.bedrooms)} raw={l.bedroomsRaw} />
                  <Fact label="Baths" value={fmtBaths(l.bathrooms)} raw={l.bathroomsRaw} />
                  <Fact
                    label="Size"
                    value={l.squareFeet ? `${l.squareFeet.toLocaleString()} sqft` : "unknown"}
                    raw={l.squareFeetRaw}
                  />
                  <Fact
                    label="$/sqft"
                    value={l.pricePerSquareFoot ? `$${l.pricePerSquareFoot}` : "—"}
                  />
                  <Fact label="Available" value={fmtDate(l.availableDate)} />
                  <Fact label="Move-in" value={fmtDate(l.moveInDate)} />
                  <Fact
                    label="Cats"
                    value={l.catsAllowed == null ? "unknown" : l.catsAllowed ? "allowed" : "no"}
                  />
                  <Fact
                    label="Dogs"
                    value={l.dogsAllowed == null ? "unknown" : l.dogsAllowed ? "allowed" : "no"}
                    raw={l.dogRestrictionsRaw}
                  />
                  <Fact
                    label="Laundry"
                    value={(l.laundryNormalized ?? "unknown").replaceAll("_", " ")}
                    raw={l.laundryRaw}
                  />
                  <Fact
                    label="Parking"
                    value={(l.parkingNormalized ?? "unknown").replaceAll("_", " ")}
                    raw={l.parkingRaw}
                  />
                  <Fact label="Deposit" value={l.depositRaw ?? fmtMoney(l.depositAmount)} />
                  <Fact label="Lease" value={l.leaseTermRaw ?? "unknown"} />
                  <Fact label="App fee" value={l.applicationFeeRaw ?? "—"} />
                  <Fact label="Broker fee" value={l.brokerFeeRaw ?? "—"} />
                  <Fact
                    label="Utilities"
                    value={
                      l.utilitiesIncluded.length > 0
                        ? l.utilitiesIncluded.join(", ")
                        : (l.utilitiesRaw ?? "unknown")
                    }
                  />
                  {l.concessionsRaw && (
                    <Fact label="Concessions" value={l.concessionsRaw} highlight />
                  )}
                </div>

                {/* Description */}
                {l.description && (
                  <div>
                    <SectionTitle>Description</SectionTitle>
                    <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-ink/85">
                      {l.description}
                    </p>
                  </div>
                )}

                {/* Amenities */}
                {l.amenitiesRaw.length > 0 && (
                  <div>
                    <SectionTitle>Amenities (as listed)</SectionTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {l.amenitiesRaw.map((a) => (
                        <span
                          key={a}
                          className="rounded-full bg-line/50 px-2.5 py-1 text-[12px] text-muted"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duplicates / reposts */}
                {data.duplicates.length > 0 && (
                  <div className="rounded-xl border border-line bg-paper/60 px-4 py-3.5">
                    <SectionTitle>
                      Possible duplicate / repost
                      {data.duplicateGroup && (
                        <span className="ml-2 normal-case">
                          <ConfidenceChip confidence={data.duplicateGroup.confidence} />
                        </span>
                      )}
                    </SectionTitle>
                    {data.duplicateGroup && (
                      <p className="mb-2 text-[12.5px] text-muted">
                        {data.duplicateGroup.crossSource
                          ? "Also seen on another source. "
                          : "Another listing on the same source matches this one. "}
                        Matched by:{" "}
                        {data.duplicateGroup.reasons
                          .map((r) => r.replaceAll("_", " "))
                          .join(", ")}
                        .
                      </p>
                    )}
                    <ul className="flex flex-col gap-1.5">
                      {data.duplicates.map((d) => (
                        <li key={d.id} className="text-[13px] text-muted">
                          <a
                            href={d.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            {d.title}
                          </a>{" "}
                          — {fmtMoney(d.priceMonthly)} on {d.sourceName}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11.5px] text-faint">
                      Grouped automatically — listings are never merged. Verify on the
                      original pages.
                    </p>
                  </div>
                )}

                {/* Price history */}
                {data.priceHistory.length > 0 && (
                  <div>
                    <SectionTitle>Price history</SectionTitle>
                    <ul className="flex flex-col gap-1">
                      {data.priceHistory.map((h, i) => (
                        <li key={h.observedAt + i} className="flex gap-2 text-[12.5px]">
                          <span className="w-16 shrink-0 text-faint">
                            {fmtDateShort(h.observedAt)}
                          </span>
                          <span className="text-muted">
                            {h.priceMonthly != null ? (
                              <span
                                className={
                                  i === 0 ? "font-medium text-ink" : undefined
                                }
                              >
                                {fmtMoney(h.priceMonthly)}
                              </span>
                            ) : (
                              <span title="price could not be parsed">
                                {h.priceRaw ?? "no price"}
                              </span>
                            )}
                            {h.priceEffectiveMonthly != null &&
                              h.priceEffectiveMonthly !== h.priceMonthly && (
                                <span className="text-good">
                                  {" "}
                                  ({fmtMoney(h.priceEffectiveMonthly)} effective)
                                </span>
                              )}
                            {i === data.priceHistory.length - 1 && (
                              <span className="text-faint"> · first seen price</span>
                            )}
                            {h.concessionsRaw && (
                              <span className="text-faint"> · {h.concessionsRaw}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* History */}
                {data.events.length > 0 && (
                  <div>
                    <SectionTitle>History</SectionTitle>
                    <ul className="flex flex-col gap-1">
                      {data.events.slice(0, 14).map((e) => (
                        <li key={e.id} className="flex gap-2 text-[12.5px]">
                          <span className="w-16 shrink-0 text-faint">
                            {fmtDateShort(e.createdAt)}
                          </span>
                          <span className="text-muted">
                            {EVENT_LABELS[e.eventType] ?? e.eventType}
                            {e.eventType === "price_change" && e.oldValue && e.newValue && (
                              <>
                                : {fmtMoney(Number(e.oldValue))} →{" "}
                                <span
                                  className={
                                    Number(e.newValue) < Number(e.oldValue)
                                      ? "font-medium text-good"
                                      : "font-medium text-warn"
                                  }
                                >
                                  {fmtMoney(Number(e.newValue))}
                                </span>
                              </>
                            )}
                            {e.eventType === "stale_change" && e.newValue && (
                              <>: {e.newValue.replaceAll("_", " ")}</>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Contact & links */}
                <div className="rounded-xl border border-line bg-paper/60 px-4 py-3.5">
                  <SectionTitle>Source &amp; contact</SectionTitle>
                  <div className="flex flex-col gap-1 text-[13px] text-muted">
                    <span>
                      Source: <span className="font-medium text-ink">{l.sourceName}</span>
                      {l.sourceWebsiteUrl && (
                        <>
                          {" "}
                          ·{" "}
                          <ExtLink href={l.sourceWebsiteUrl}>website</ExtLink>
                        </>
                      )}
                    </span>
                    {(l.contactPhone || l.contactEmail || l.contactUrl) && (
                      <span>
                        Contact{l.contactInheritedFromSource ? " (via source)" : ""}:{" "}
                        {l.contactName && <span className="text-ink">{l.contactName} · </span>}
                        {l.contactPhone && <span>{l.contactPhone} · </span>}
                        {l.contactEmail && <span>{l.contactEmail} · </span>}
                        {l.contactUrl && <ExtLink href={l.contactUrl}>contact page</ExtLink>}
                      </span>
                    )}
                    {l.showingInfoRaw && <span>Showings: {l.showingInfoRaw}</span>}
                    <span className="text-[12px] text-faint">
                      First seen {fmtDate(l.firstSeenAt)} · last seen{" "}
                      {relativeTime(l.lastSeenAt)}
                      {l.detailFetchedAt
                        ? ` · details fetched ${relativeTime(l.detailFetchedAt)}`
                        : " · card-level data only so far"}
                      {l.missingSince ? ` · missing since ${fmtDate(l.missingSince)}` : ""}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={l.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-accent-deep"
                    >
                      Open original listing ↗
                    </a>
                    {l.applicationUrl && (
                      <ExtButton href={l.applicationUrl}>Application</ExtButton>
                    )}
                    {l.virtualTourUrl && (
                      <ExtButton href={l.virtualTourUrl}>Virtual tour</ExtButton>
                    )}
                    {l.floorPlanUrls.map((f, i) => (
                      <ExtButton key={f} href={f}>
                        Floor plan{l.floorPlanUrls.length > 1 ? ` ${i + 1}` : ""}
                      </ExtButton>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CONFIDENCE_STYLES: Record<string, string> = {
  exact: "bg-alert/10 text-alert",
  high: "bg-warn/10 text-warn",
  medium: "bg-line/60 text-muted",
  low: "bg-line/40 text-faint",
};

function ConfidenceChip({ confidence }: { confidence: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase ${CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.low}`}
    >
      {confidence} confidence
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
      {children}
    </h3>
  );
}

function Fact({
  label,
  value,
  raw,
  highlight,
}: {
  label: string;
  value: string;
  raw?: string | null;
  highlight?: boolean;
}) {
  return (
    <div title={raw ? `Raw: ${raw}` : undefined}>
      <div className="text-[11px] tracking-wide text-faint uppercase">{label}</div>
      <div className={`text-[13.5px] font-medium ${highlight ? "text-good" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
    >
      {children}
    </a>
  );
}

function ExtButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-muted transition hover:border-faint hover:text-ink"
    >
      {children} ↗
    </a>
  );
}
