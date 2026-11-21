"use client";

import { PRESETS, sydneyToday, useFilters, type Preset } from "@/lib/filters";
import { PROPERTIES, range, short } from "@/lib/format";
import { useOverview, useParams } from "@/lib/queries";

const COMPARED: Record<Preset, string> = {
  "this-week": "last week",
  "last-week": "the week before",
  "4-weeks": "the 4 weeks before",
  "3-months": "the 3 months before",
  custom: "the same number of days before",
};

/** Page title, the exact dates being shown, and the period switcher. */
export function PageHeader({ title, compare = false, extra }: { title: string; compare?: boolean; extra?: string }) {
  const [filters, update] = useFilters();
  const { params, ready } = useParams();
  const overview = useOverview(params, ready && compare);
  const property = PROPERTIES.find((p) => p.slug === filters.property)?.name;
  const p = overview.data?.period;

  let subtitle: string;
  if (!ready) subtitle = "Pick a start and an end date to see this period.";
  else if (params.from && params.to) {
    subtitle = range(String(params.from), String(params.to));
    if (extra) subtitle += ` (${extra})`;
    if (!compare) subtitle += property ? `, ${property}` : ", all four properties";
    else if (p) subtitle += `, compared with ${COMPARED[filters.preset]} (${short(p.previous_from)} to ${short(p.previous_to)})`;
  } else subtitle = "";

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 min-h-5 text-[13px] text-muted">{subtitle}</p>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-seg p-[3px]">
          {PRESETS.map((o) => (
            <button
              key={o.value}
              aria-pressed={filters.preset === o.value}
              onClick={() => update({ preset: o.value })}
              className={`whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[13px] ${filters.preset === o.value ? "bg-raised font-semibold text-ink shadow-[0_1px_2px_rgb(20_33_43/0.12)]" : "text-muted hover:text-ink"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {filters.preset === "custom" && (
          <div className="flex items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5">
              <span className="text-muted">From</span>
              <input type="date" value={filters.from ?? ""} max={filters.to ?? sydneyToday()} onChange={(e) => update({ from: e.target.value })}
                className="h-9 rounded-lg border border-line bg-surface px-2" />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">to</span>
              <input type="date" value={filters.to ?? ""} min={filters.from} max={sydneyToday()} onChange={(e) => update({ to: e.target.value })}
                className="h-9 rounded-lg border border-line bg-surface px-2" />
            </label>
          </div>
        )}
      </div>
    </header>
  );
}

/** Content area wrapper shared by every page. */
export function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 pb-8 pt-5 sm:px-7">{children}</main>;
}
