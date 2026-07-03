"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const tab = (href: string, label: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`rounded px-2 py-1 text-[13px] transition-colors ${
          active ? "font-medium text-ink" : "text-muted hover:text-ink"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header
      className="z-30 flex h-12 shrink-0 items-center gap-5 border-b border-line bg-paper px-4"
      style={{ paddingTop: "max(0px, env(safe-area-inset-top))" }}
    >
      <div className="flex items-center gap-2">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 21c4.2-4.6 7-8 7-11a7 7 0 1 0-14 0c0 3 2.8 6.4 7 11Z"
            fill="var(--color-accent)"
            fillOpacity="0.16"
            stroke="var(--color-accent)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="10" r="2.4" fill="var(--color-accent)" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Apt Scout</span>
      </div>

      <nav className="-ml-1 flex items-center gap-1">
        {tab("/", "Map")}
        {tab("/sources", "Sources")}
      </nav>

      <span className="ml-auto hidden text-[12px] text-faint sm:inline">San Francisco</span>
    </header>
  );
}
