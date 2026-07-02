"use client";

export interface Filters {
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  minBeds: number | null;
  dogs: boolean;
  cats: boolean;
  laundry: "any" | "any_laundry" | "in_unit";
  neighborhoods: string[];
  showHidden: boolean;
  showUnavailable: boolean;
  verifyOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  minPrice: null,
  maxPrice: null,
  minBeds: null,
  dogs: false,
  cats: false,
  laundry: "any",
  neighborhoods: [],
  showHidden: false,
  showUnavailable: false,
  verifyOnly: false,
};

export function FilterBar({
  filters,
  onChange,
  neighborhoods,
  shownCount,
  totalCount,
  loading,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  neighborhoods: string[];
  shownCount: number;
  totalCount: number;
  loading: boolean;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  const toggleChip = (
    label: string,
    active: boolean,
    onClick: () => void,
    title?: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface/70 px-4 py-2.5 [scrollbar-width:thin]">
      <input
        type="search"
        placeholder="Search title, address, neighborhood…"
        value={filters.query}
        onChange={(e) => set("query", e.target.value)}
        className="w-56 shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-faint"
      />
      <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1">
        <span className="text-[12px] text-faint">$</span>
        <input
          type="number"
          placeholder="min"
          value={filters.minPrice ?? ""}
          onChange={(e) => set("minPrice", e.target.value ? Number(e.target.value) : null)}
          className="w-14 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <span className="text-[12px] text-faint">–</span>
        <input
          type="number"
          placeholder="max"
          value={filters.maxPrice ?? ""}
          onChange={(e) => set("maxPrice", e.target.value ? Number(e.target.value) : null)}
          className="w-14 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
      </div>
      <select
        value={filters.minBeds ?? ""}
        onChange={(e) => set("minBeds", e.target.value === "" ? null : Number(e.target.value))}
        className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted outline-none focus:border-faint"
      >
        <option value="">Any beds</option>
        <option value="0">Studio+</option>
        <option value="1">1+ bd</option>
        <option value="2">2+ bd</option>
        <option value="3">3+ bd</option>
      </select>
      <select
        value={filters.laundry}
        onChange={(e) => set("laundry", e.target.value as Filters["laundry"])}
        className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted outline-none focus:border-faint"
      >
        <option value="any">Any laundry</option>
        <option value="any_laundry">In unit or building</option>
        <option value="in_unit">In unit only</option>
      </select>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const next = filters.neighborhoods.includes(v)
            ? filters.neighborhoods.filter((n) => n !== v)
            : [...filters.neighborhoods, v];
          set("neighborhoods", next);
        }}
        className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted outline-none focus:border-faint"
      >
        <option value="">
          {filters.neighborhoods.length > 0
            ? `${filters.neighborhoods.length} neighborhood${filters.neighborhoods.length > 1 ? "s" : ""}`
            : "Neighborhoods"}
        </option>
        {neighborhoods.map((n) => (
          <option key={n} value={n}>
            {filters.neighborhoods.includes(n) ? "✓ " : ""}
            {n}
          </option>
        ))}
      </select>
      {toggleChip("🐕 Dogs", filters.dogs, () => set("dogs", !filters.dogs), "Dog-friendly only")}
      {toggleChip("🐈 Cats", filters.cats, () => set("cats", !filters.cats), "Cat-friendly only")}
      {toggleChip(
        "Verify ⚠",
        filters.verifyOnly,
        () => set("verifyOnly", !filters.verifyOnly),
        "Only listings with suspicious signals",
      )}
      {toggleChip("Hidden", filters.showHidden, () => set("showHidden", !filters.showHidden), "Include listings you hid or marked not-a-fit")}
      {toggleChip(
        "Gone",
        filters.showUnavailable,
        () => set("showUnavailable", !filters.showUnavailable),
        "Include likely-unavailable/removed listings",
      )}
      {filters !== DEFAULT_FILTERS &&
        JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS) && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="shrink-0 text-[12px] font-medium text-accent hover:text-accent-deep"
          >
            Reset
          </button>
        )}
      <span className="ml-auto shrink-0 pl-2 text-[12px] whitespace-nowrap text-faint">
        {loading ? "Loading…" : `${shownCount} of ${totalCount} listings`}
      </span>
    </div>
  );
}
