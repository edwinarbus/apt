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
        className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
          active
            ? "bg-ink text-paper"
            : "text-muted hover:bg-line/60 hover:text-ink"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-5 border-b border-line/60 bg-paper/85 px-4 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep font-display text-[15px] font-bold text-white shadow-sm">
          A
        </span>
        <span className="font-display text-[22px] font-semibold tracking-tight text-ink">
          Apt
        </span>
        <span className="hidden self-center text-[13px] text-muted sm:block">
          San Francisco apartment scout
        </span>
      </div>
      <nav className="flex items-center gap-1.5">
        {tab("/", "Map")}
        {tab("/sources", "Sources")}
      </nav>
      <div className="ml-auto hidden text-[12px] text-faint md:block">
        Personal research tool — always verify details with the original listing.
      </div>
    </header>
  );
}
