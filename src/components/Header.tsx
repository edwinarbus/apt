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
        className={`relative px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors ${
          active ? "text-ink" : "text-faint hover:text-muted"
        }`}
      >
        {label}
        {active && (
          <span className="absolute inset-x-1.5 -bottom-[7px] h-px bg-accent" />
        )}
      </Link>
    );
  };

  return (
    <header
      className="z-30 flex h-11 shrink-0 items-center gap-4 border-b border-line bg-paper px-3.5"
      style={{ paddingTop: "max(0px, env(safe-area-inset-top))" }}
    >
      <div className="flex items-center gap-2">
        {/* Logo mark: a precise radar tick, not a gradient blob. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9.2" stroke="var(--color-line-strong)" strokeWidth="1.4" />
          <circle cx="12" cy="12" r="4.4" stroke="var(--color-line-strong)" strokeWidth="1.4" />
          <path d="M12 12 L12 3.2" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.5" fill="var(--color-accent)" />
        </svg>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
          Apt Scout
        </span>
        <span className="hidden font-mono text-[10px] tracking-[0.14em] text-faint uppercase sm:inline">
          SF rental radar
        </span>
      </div>

      <nav className="flex items-center gap-1">
        {tab("/", "Map")}
        {tab("/sources", "Sources")}
      </nav>

      <div className="ml-auto hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-faint uppercase md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-good/80" />
        Verify with source · personal use
      </div>
    </header>
  );
}
