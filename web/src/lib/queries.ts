"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type Health, type Overview, type Problems, type ReviewCounts, type ReviewPage, type Topics, type Trends } from "./api";
import { addDays, apiParams, monday, rangeReady, sydneyToday, useFilters } from "./filters";

type Params = Record<string, string | number | boolean | undefined>;

function useApi<T>(path: string, params: Params, enabled = true) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => api<T>(path, params).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The current property and date range as API params, plus whether custom dates are complete. */
export function useParams() {
  const [filters] = useFilters();
  return useMemo(() => ({ params: apiParams(filters) as Params, ready: rangeReady(filters), filters }), [filters]);
}

export function useOverview(params: Params, enabled = true) {
  return useApi<Overview>("overview", params, enabled);
}

/** Overview for all four properties in the current period (sidebar averages). */
export function useAllOverview() {
  const { params, ready } = useParams();
  return useOverview({ from: params.from, to: params.to }, ready);
}

export function useCounts(params: Params, enabled = true) {
  return useApi<ReviewCounts>("reviews/counts", params, enabled);
}

export function useReviews(params: Params, enabled = true) {
  return useApi<ReviewPage>("reviews", params, enabled);
}

export function useTopics(params: Params, enabled = true) {
  return useApi<Topics>("topics", params, enabled);
}

export function useProblems(params: Params, enabled = true) {
  return useApi<Problems>("issues", params, enabled);
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => api<Health>("health").then((r) => r.data), refetchInterval: 60_000 });
}

/** Weekly buckets: at least the 12 weeks ending at the period's end, so a single week has context. */
export function useWeekly(property: string | undefined, to: string | undefined, from: string | undefined, enabled = true) {
  const end = to ?? sydneyToday();
  const twelve = addDays(monday(end), -77); // Monday 11 weeks before the week that holds `end`
  const start = from && from < twelve ? from : twelve;
  return useApi<Trends>("trends", { property, from: start, to: end, interval: "week" }, enabled);
}
