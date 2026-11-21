"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Overview, type Problems, type Topics, type Trends as TrendData } from "@/lib/api";
import { addDays, apiParams, briefingParams, sydneyToday, useFilters } from "@/lib/filters";
import { range } from "@/lib/format";
import { FilterBar, HealthPanel } from "./FilterBar";
import { Handover } from "./Handover";
import { TopicInsights, TopProblems } from "./Insights";
import { NeedsAttention } from "./NeedsAttention";
import { Ratings } from "./Ratings";
import { ReviewDialogProvider } from "./ReviewDialog";
import { type FeedFilters, ReviewFeed } from "./ReviewFeed";
import { Trends } from "./Trends";
import { ErrorNote, Section, Skeleton } from "./ui";

function useApi<T>(key: string, path: string, params: Record<string, unknown>) {
  return useQuery({ queryKey: [key, params], queryFn: () => api<T>(path, params as Record<string, string>).then((r) => r.data) });
}

export function Dashboard() {
  const [filters, update] = useFilters();
  const params = useMemo(() => apiParams(filters), [filters]);
  const [feed, setFeed] = useState<FeedFilters>({});

  // Trends always show at least 12 weeks, so a single week has context.
  const trendParams = useMemo(() => {
    const to = params.to ?? sydneyToday();
    const twelveWeeks = addDays(to, -83);
    return { property: params.property, to, from: params.from && params.from < twelveWeeks ? params.from : twelveWeeks };
  }, [params]);

  const overview = useApi<Overview>("overview", "overview", params);
  const topics = useApi<Topics>("topics", "topics", params);
  const problems = useApi<Problems>("issues", "issues", { ...params, limit: 10 });
  const trends = useApi<TrendData>("trends", "trends", trendParams);

  const period = overview.data?.period;
  const periodText = period ? `${period.label === "in this period" ? "this period" : period.label} (${range(period.from, period.to)})` : "this period";
  const toFeed = (f: FeedFilters) => {
    setFeed(f);
    document.getElementById("reviews")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <ReviewDialogProvider>
      <FilterBar filters={filters} update={update} />
      <main className="mx-auto max-w-6xl space-y-12 px-4 pb-16 pt-8 sm:px-6">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Summary" className="min-w-0 [overflow-wrap:anywhere]">
            <Handover params={briefingParams(filters)} periodLabel={periodText} />
          </section>
          <section aria-labelledby="attention" className="min-w-0 lg:border-l lg:border-line lg:pl-8">
            <h2 id="attention" className="mb-3 text-xl font-semibold tracking-tight">Needs attention</h2>
            <NeedsAttention params={params} onShowAll={(f) => toFeed({ urgent: f.urgent, unanswered: f.unanswered })} />
          </section>
        </div>

        <Section title="Ratings" aside={period && <>Compared with {period.previous_label} ({range(period.previous_from, period.previous_to)})</>}>
          {overview.isPending ? <Skeleton lines={5} /> : overview.isError ? <ErrorNote error={overview.error} retry={overview.refetch} /> : <Ratings data={overview.data} />}
        </Section>

        <Section title="What guests mention" aside="Topics are found in every review, in any language">
          {topics.isPending ? <Skeleton lines={6} /> : topics.isError ? <ErrorNote error={topics.error} retry={topics.refetch} /> : (
            <TopicInsights data={topics.data} onTopic={(topic) => toFeed({ topic })} />
          )}
        </Section>

        <Section title="Most common problems" aside={problems.data && `${problems.data.reviews_in_period} reviews in this period. Click a problem to read the reviews.`}>
          {problems.isPending ? <Skeleton lines={6} /> : problems.isError ? <ErrorNote error={problems.error} retry={problems.refetch} /> : (
            <TopProblems data={problems.data} onProblem={(id, label) => toFeed({ problem: { id, label } })} />
          )}
        </Section>

        <Section title="Trends" aside={trends.data && range(trends.data.from, trends.data.to)}>
          {trends.isPending ? <Skeleton lines={6} /> : trends.isError ? <ErrorNote error={trends.error} retry={trends.refetch} /> : <Trends data={trends.data} />}
        </Section>

        <Section id="reviews" title="Reviews" aside={period && range(period.from, period.to)}>
          <ReviewFeed params={params} filters={feed} setFilters={setFeed} />
        </Section>

        <HealthPanel />
      </main>
    </ReviewDialogProvider>
  );
}
