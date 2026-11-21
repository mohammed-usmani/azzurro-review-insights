"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type Preset = "this-week" | "last-week" | "4-weeks" | "3-months" | "custom";

export const PRESETS: { value: Preset; label: string }[] = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "4-weeks", label: "Last 4 weeks" },
  { value: "3-months", label: "Last 3 months" },
  { value: "custom", label: "Custom dates" },
];

/** Today's date in Sydney, where all four hotels are (YYYY-MM-DD). */
export function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monday(iso: string): string {
  const weekday = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -weekday);
}

/** The date range a preset stands for (Sydney dates). */
export function presetRange(preset: Preset, from?: string, to?: string): { from?: string; to?: string } {
  const today = sydneyToday();
  switch (preset) {
    case "this-week": return { from: monday(today), to: today };
    case "last-week": return { from: addDays(monday(today), -7), to: addDays(monday(today), -1) };
    case "4-weeks": return { from: addDays(today, -27), to: today };
    case "3-months": return { from: addDays(today, -90), to: today };
    case "custom": return { from, to };
  }
}

export interface Filters { property: string; preset: Preset; from?: string; to?: string }

/** Property and dates live in the URL, so a view can be shared or bookmarked. */
export function useFilters(): [Filters, (next: Partial<Filters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const preset = (params.get("period") as Preset) || "this-week";
  const filters: Filters = {
    property: params.get("property") ?? "",
    preset: PRESETS.some((p) => p.value === preset) ? preset : "this-week",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
  const update = useCallback(
    (next: Partial<Filters>) => {
      const merged = { ...filters, ...next };
      const qs = new URLSearchParams();
      if (merged.property) qs.set("property", merged.property);
      if (merged.preset !== "this-week") qs.set("period", merged.preset);
      if (merged.preset === "custom") {
        if (merged.from) qs.set("from", merged.from);
        if (merged.to) qs.set("to", merged.to);
      }
      router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router],
  );
  return [filters, update];
}

/** Query params shared by every dashboard request. */
export function apiParams(f: Filters) {
  const range = presetRange(f.preset, f.from, f.to);
  return { property: f.property || undefined, from: range.from, to: range.to };
}

/** The briefing for "this week" is pre-generated under the server's default period, so send no dates. */
export function briefingParams(f: Filters) {
  return f.preset === "this-week" ? { property: f.property || undefined } : apiParams(f);
}
