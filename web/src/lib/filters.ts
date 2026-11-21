"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

export type Preset = "this-week" | "last-week" | "4-weeks" | "3-months" | "custom";

export const PRESETS: { value: Preset; label: string }[] = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "4-weeks", label: "4 weeks" },
  { value: "3-months", label: "3 months" },
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

export function monday(iso: string): string {
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

const FILTER_KEYS = ["property", "period", "from", "to"];

// router.replace updates the URL a moment later, so a second quick update (end date right after start date)
// would merge onto the old URL. Keep the last URL we asked for until the router catches up.
let pendingSearch: string | null = null;

/** Property and dates live in the URL, so a view can be shared or bookmarked, and every page keeps them. */
export function useFilters(): [Filters, (next: Partial<Filters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const preset = (params.get("period") as Preset) || "this-week";
  const filters = useMemo<Filters>(() => ({
    property: params.get("property") ?? "",
    preset: PRESETS.some((p) => p.value === preset) ? preset : "this-week",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  }), [params, preset]);
  useEffect(() => {
    if (pendingSearch !== null && params.toString() === pendingSearch) pendingSearch = null;
  }, [params]);
  const update = useCallback(
    (next: Partial<Filters>) => {
      // read the live URL, not the last render: two quick updates (start date, then end date) must both stick
      const qs = new URLSearchParams(pendingSearch ?? window.location.search);
      const live: Filters = {
        property: qs.get("property") ?? "",
        preset: (qs.get("period") as Preset) || "this-week",
        from: qs.get("from") ?? undefined,
        to: qs.get("to") ?? undefined,
      };
      const merged = { ...live, ...next };
      FILTER_KEYS.forEach((k) => qs.delete(k));
      qs.delete("review"); // the selected review may not be in the new range
      if (merged.property) qs.set("property", merged.property);
      if (merged.preset !== "this-week") qs.set("period", merged.preset);
      if (merged.preset === "custom") {
        if (merged.from) qs.set("from", merged.from);
        if (merged.to) qs.set("to", merged.to);
      }
      pendingSearch = qs.toString();
      router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
  return [filters, update];
}

/** A link to another page that keeps the current property and period, plus any extra params. */
export function useLinkTo() {
  const params = useSearchParams();
  return useCallback(
    (path: string, extra: Record<string, string | number | undefined> = {}) => {
      const qs = new URLSearchParams();
      FILTER_KEYS.forEach((k) => params.get(k) && qs.set(k, params.get(k)!));
      Object.entries(extra).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
      return qs.size ? `${path}?${qs}` : path;
    },
    [params],
  );
}

/** Query params shared by every dashboard request. */
export function apiParams(f: Filters) {
  const range = presetRange(f.preset, f.from, f.to);
  return { property: f.property || undefined, from: range.from, to: range.to };
}

/** Custom dates are usable once both are set and in order. */
export function rangeReady(f: Filters) {
  return f.preset !== "custom" || Boolean(f.from && f.to && f.from <= f.to);
}

/** The briefing for "this week" is pre-generated under the server's default period, so send no dates. */
export function briefingParams(f: Filters) {
  return f.preset === "this-week" ? { property: f.property || undefined } : apiParams(f);
}
