"use client";

import { useState } from "react";

/**
 * Image with graceful degradation: broken/missing URLs render a quiet
 * placeholder instead of a browser broken-image glyph. Listing photos come
 * from third-party CDNs and go stale routinely.
 */
export function PhotoImg({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  // Track which src failed so a new src naturally resets the fallback.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src != null && failedSrc === src;

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-line/70 to-paper text-faint ${className ?? ""}`}
      >
        <span className="text-[11px] font-medium tracking-wide uppercase">
          No photo
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party listing CDNs; next/image domains unknowable
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      // quiet slab behind the box while the photo streams in — no blank hole
      className={`bg-elevated/60 ${className ?? ""}`}
      onError={() => setFailedSrc(src)}
    />
  );
}
