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
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-paper/95 px-5">
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-[22px] font-semibold tracking-tight text-accent">
          Apt
        </span>
        <span className="hidden text-[13px] text-muted sm:block">
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
