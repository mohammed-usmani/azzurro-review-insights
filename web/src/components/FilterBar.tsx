"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type Health } from "@/lib/api";
import { type Filters, PRESETS, type Preset, presetRange, sydneyToday, addDays } from "@/lib/filters";
import { ago, PROPERTIES } from "@/lib/format";

export function FilterBar({ filters, update }: { filters: Filters; update: (f: Partial<Filters>) => void }) {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<Health>("health").then((r) => r.data) });
  const control = "h-9 rounded-md border border-line bg-surface px-2.5 text-sm";

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <p className="mr-auto font-semibold">Azzurro guest reviews</p>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Property</span>
          <select className={control} value={filters.property} onChange={(e) => update({ property: e.target.value })}>
            <option value="">All four properties</option>
            {PROPERTIES.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Period</span>
          <select
            className={control}
            value={filters.preset}
            onChange={(e) => {
              const preset = e.target.value as Preset;
              // custom starts from the last 4 weeks so the date inputs are never empty
              const seed = preset === "custom" ? presetRange("4-weeks") : {};
              update({ preset, from: filters.from ?? seed.from, to: filters.to ?? seed.to });
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>

        {filters.preset === "custom" && (
          <div className="flex items-center gap-1.5 text-sm">
            <input type="date" aria-label="From" className={control} value={filters.from ?? ""} max={filters.to ?? sydneyToday()}
              onChange={(e) => e.target.value && update({ from: e.target.value })} />
            <span className="text-muted">to</span>
            <input type="date" aria-label="To" className={control} value={filters.to ?? ""} min={filters.from} max={addDays(sydneyToday(), 0)}
              onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </div>
        )}

        {health.data && (
          <a href="#data-health" className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            <span aria-hidden className={`size-2 rounded-full ${health.data.status === "ok" ? "bg-good" : health.data.status === "stale" ? "bg-warn" : "bg-urgent"}`} />
            {health.data.status === "failing" ? "Collection failing" : `Updated ${ago(Math.max(...health.data.properties.map((p) => p.last_collected_at ?? 0)))}`}
          </a>
        )}
      </div>
    </div>
  );
}

export function HealthPanel() {
  const q = useQuery({ queryKey: ["health"], queryFn: () => api<Health>("health").then((r) => r.data) });
  if (!q.data) return null;
  const h = q.data;
  return (
    <section id="data-health" className="scroll-mt-28 border-t border-line pt-6 text-sm text-muted">
      <h2 className="mb-3 text-base font-semibold text-ink">Where this data comes from</h2>
      <p className="mb-3 max-w-prose">
        Reviews are collected from each property&apos;s public Booking.com page. New reviews are added on every run, and
        reviews already stored are never duplicated. A property is marked out of date if it hasn&apos;t been collected for{" "}
        {h.stale_after_hours} hours.
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="text-faint">
            <tr><th className="py-1.5 font-normal">Property</th><th className="font-normal">Last collected</th><th className="font-normal">Reviews stored</th><th className="font-normal">Status</th></tr>
          </thead>
          <tbody>
            {h.properties.map((p) => (
              <tr key={p.property} className="border-t border-line">
                <td className="py-1.5 text-ink">{p.name}</td>
                <td>{ago(p.last_collected_at)}</td>
                <td>
                  {p.stored_reviews.toLocaleString()}
                  {p.reported_reviews != null && ` of ${p.reported_reviews.toLocaleString()} on Booking.com`}
                  {p.reported_reviews != null && p.stored_reviews < p.reported_reviews && " (newest kept)"}
                </td>
                <td className={p.status === "ok" ? "text-good" : p.status === "stale" ? "text-warn" : "text-urgent"}>
                  {p.status === "ok" ? "Up to date" : p.status === "stale" ? "Out of date" : `Failing: ${p.last_error}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3">
        {h.analysed.toLocaleString()} of {h.with_text.toLocaleString()} written reviews have been read by the AI
        (translated and tagged).{" "}
        {!h.llm_enabled && "AI analysis is off on this server, so new reviews are tagged with keywords only."}
      </p>
    </section>
  );
}
