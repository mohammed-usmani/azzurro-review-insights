"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Overview as OverviewData, Review, TopicStat } from "@/lib/api";
import { sydneyToday, useFilters, useLinkTo } from "@/lib/filters";
import { daysBetween, day, plural, PROPERTIES, score, short, SHORT_NAMES, TOPIC_LABEL } from "@/lib/format";
import { useCounts, useOverview, useParams, useReviews, useTopics, useWeekly } from "@/lib/queries";
import { SummaryBar } from "./Briefing";
import { Page, PageHeader } from "./PageHeader";
import { useOpenReview } from "./ReviewDialog";
import { Delta, Empty, ErrorNote, Few, Panel, PanelHeader, ScoreChip, Skeleton, Tabs } from "./ui";

export function Overview() {
  const { params, ready, filters } = useParams();
  const overview = useOverview(params, ready);
  const title = PROPERTIES.find((p) => p.slug === filters.property)?.name ?? "All four properties";

  return (
    <Page>
      <PageHeader title={title} compare />
      {ready && (
        <>
          <SummaryBar />
          {overview.isPending ? <Panel><Skeleton lines={3} className="p-5" /></Panel>
            : overview.isError ? <Panel><ErrorNote error={overview.error} retry={overview.refetch} /></Panel>
            : <Kpis data={overview.data} />}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel aria-labelledby="props-h" className="xl:col-span-2">
              <PanelHeader id="props-h" title="Properties">Lowest average first</PanelHeader>
              {overview.data ? <PropertyTable data={overview.data} /> : overview.isError ? null : <Skeleton lines={4} className="px-5 pb-5" />}
            </Panel>
            <Attention />
            <TrendPanel />
            <TopicBars />
          </div>
        </>
      )}
    </Page>
  );
}

function Tile({ label, href, children }: { label: string; href?: string; children: React.ReactNode }) {
  const body = (
    <>
      <p className="text-[12.5px] text-muted">{label}</p>
      {children}
    </>
  );
  const cls = "block min-w-0 bg-surface px-4 py-4 sm:px-5";
  return href ? <Link href={href} className={`${cls} hover:bg-paper/60`}>{body}</Link> : <div className={cls}>{body}</div>;
}

const Big = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <p className={`mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[28px] font-bold leading-tight tracking-tight sm:text-[32px] ${className}`}>{children}</p>
);

function Kpis({ data }: { data: OverviewData }) {
  const { params, ready } = useParams();
  const linkTo = useLinkTo();
  const counts = useCounts(params, ready);
  const urgent = useReviews({ ...params, urgent: true, limit: 1 }, ready);
  const c = data.current, p = data.previous;
  const share = (w: typeof c) => (w.reviews ? (w.negative / w.reviews) * 100 : null);
  const negNow = share(c), negBefore = share(p);
  const firstUrgent = urgent.data?.items[0];
  const waiting = counts.data?.no_reply_oldest ? daysBetween(counts.data.no_reply_oldest, sydneyToday()) : null;

  return (
    <Panel aria-label="Key numbers" className="grid grid-cols-2 gap-px overflow-hidden bg-line-soft sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
      <Tile label="Average rating">
        <Big>{score(c.avg_score)}<span className="text-[12.5px] font-normal text-muted">/ 10</span></Big>
        <Delta value={data.avg_change} from={p.avg_score != null ? `${score(p.avg_score)} before` : undefined} />
      </Tile>
      <Tile label="Reviews">
        <Big>{c.reviews.toLocaleString("en-AU")}</Big>
        <p className="text-[12.5px] text-muted">{p.reviews.toLocaleString("en-AU")} in the period before</p>
      </Tile>
      <Tile label="Negative reviews (6 or below)">
        <Big>{negNow == null ? "–" : `${Math.round(negNow)}%`}<span className="text-[12.5px] font-normal text-muted">{c.negative} of {c.reviews}</span></Big>
        <Delta value={negNow != null && negBefore != null ? negNow - negBefore : null} unit=" pts" goodWhenUp={false}
          from={negBefore != null ? `${Math.round(negBefore)}% before` : undefined} />
      </Tile>
      <Tile label="Poor reviews without a reply" href={linkTo("/reviews", { view: "reply" })}>
        <Big className={counts.data?.no_reply ? "text-warn" : ""}>{counts.data?.no_reply ?? "–"}</Big>
        <p className="text-[12.5px] text-muted">
          {counts.data?.no_reply ? `Oldest waiting ${plural(waiting ?? 0, "day")}` : counts.data ? "All answered" : " "}
        </p>
      </Tile>
      <Tile label="Urgent" href={linkTo("/reviews", { view: "urgent" })}>
        <Big className={counts.data?.urgent ? "text-urgent" : ""}>{counts.data?.urgent ?? "–"}</Big>
        <p className="truncate text-[12.5px] text-muted">
          {firstUrgent ? `${firstUrgent.urgent_reason ?? "Safety risk"}, ${SHORT_NAMES[firstUrgent.property]}` : counts.data ? "Nothing urgent" : " "}
        </p>
      </Tile>
    </Panel>
  );
}

function PropertyTable({ data }: { data: OverviewData }) {
  const [, update] = useFilters();
  const rows = [...data.by_property].sort((a, b) => (a.current.avg_score ?? 99) - (b.current.avg_score ?? 99));
  const th = "px-3 py-2 text-left text-xs font-medium text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
  const td = "border-t border-line-soft px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr><th className={th}>Property</th><th className={th}>Average</th><th className={th}>Change</th><th className={th}>Last 12 weeks</th><th className={`${th} text-right`}>Reviews</th><th className={th}>Negative</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.property}>
                <td className={td}>
                  <button onClick={() => update({ property: r.property })} className="whitespace-nowrap text-left font-semibold hover:text-accent" title={`Show only ${r.name}`}>{SHORT_NAMES[r.property]}</button>
                </td>
                <td className={`${td} text-lg font-bold`}>{score(r.current.avg_score)}</td>
                <td className={`${td} whitespace-nowrap`}><Delta value={r.avg_change} from={r.previous.avg_score != null ? score(r.previous.avg_score) : undefined} /></td>
                <td className={`${td} py-1.5`}><Sparkline property={r.property} /></td>
                <td className={`${td} whitespace-nowrap text-right`}>{r.current.reviews}<Few n={r.current.reviews} /></td>
                <td className={td}>
                  {r.current.reviews ? (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="h-1.5 w-12 rounded-full bg-line-soft" aria-hidden>
                        <span className="block h-1.5 rounded-full bg-neg" style={{ width: `${(r.current.negative / r.current.reviews) * 100}%` }} />
                      </span>
                      {r.current.negative} of {r.current.reviews}
                    </span>
                  ) : <span className="text-muted">No reviews</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 pb-3.5 pt-2 text-[12.5px] text-muted sm:px-5">
        Dotted line: 6.0, the top of the negative band. &ldquo;Few&rdquo;: under 5 reviews, so the average can swing a lot. Click a name to show only that property.
      </p>
    </>
  );
}

/** 12 weekly averages ending at the period's end; gaps are weeks with no reviews. */
function Sparkline({ property }: { property: string }) {
  const { params, ready } = useParams();
  const q = useWeekly(property, params.to as string | undefined, undefined, ready);
  const b = q.data?.buckets.slice(-12) ?? [];
  if (!b.length) return <span className="block h-9 w-[120px] animate-pulse rounded bg-line-soft" aria-hidden />;
  const x = (i: number) => 2 + (i * 116) / Math.max(b.length - 1, 1);
  const y = (v: number) => 34 - v * 3.2;
  const segments: string[] = [];
  let seg: string[] = [];
  b.forEach((w, i) => {
    if (w.avg_score == null) { if (seg.length) segments.push(seg.join(" ")); seg = []; }
    else seg.push(`${x(i).toFixed(1)},${y(w.avg_score).toFixed(1)}`);
  });
  if (seg.length) segments.push(seg.join(" "));
  const last = [...b].reverse().find((w) => w.avg_score != null);
  const lastI = last ? b.lastIndexOf(last) : -1;
  const first = b.find((w) => w.avg_score != null);
  return (
    <svg width="120" height="36" viewBox="0 0 120 36" role="img"
      aria-label={first && last ? `Weekly average over 12 weeks, from ${score(first.avg_score)} to ${score(last.avg_score)}` : "No reviews in the last 12 weeks"}>
      <line x1="0" y1={y(6)} x2="120" y2={y(6)} stroke="var(--line)" strokeDasharray="2 3" />
      {segments.map((s, i) => s.includes(" ")
        ? <polyline key={i} points={s} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
        : <circle key={i} cx={s.split(",")[0]} cy={s.split(",")[1]} r="1.5" fill="var(--ink)" />)}
      {last && <circle cx={x(lastI)} cy={y(last.avg_score!)} r="2.5" fill="var(--ink)" />}
    </svg>
  );
}

function attentionText(r: Review) {
  const title = r.title_en ?? r.title;
  if (title) return title;
  const disliked = r.negative_en ?? r.negative;
  if (disliked) return `Disliked: ${disliked}`;
  const liked = r.positive_en ?? r.positive;
  return liked ? `Liked: ${liked}` : "Score only";
}

function Attention() {
  const { params, ready } = useParams();
  const linkTo = useLinkTo();
  const open = useOpenReview();
  const [tab, setTab] = useState<"urgent" | "reply">("urgent");
  const counts = useCounts(params, ready);
  const urgent = useReviews({ ...params, urgent: true, sort: "newest", limit: 5 }, ready);
  const reply = useReviews({ ...params, sentiment: "negative", replied: false, has_text: true, sort: "oldest", limit: 5 }, ready);
  const q = tab === "urgent" ? urgent : reply;
  const today = sydneyToday();
  const total = tab === "urgent" ? counts.data?.urgent : counts.data?.no_reply;

  return (
    <Panel aria-labelledby="att-h" className="flex flex-col">
      <div className="px-4 pt-3.5 sm:px-5"><h2 id="att-h" className="text-[15px] font-semibold">Needs attention</h2></div>
      <div className="border-b border-line-soft px-4 pt-1.5 sm:px-5">
        <Tabs label="Needs attention" value={tab} onChange={setTab} options={[
          { value: "urgent", label: <>Urgent <span className="text-muted">{counts.data?.urgent ?? ""}</span></> },
          { value: "reply", label: <>No reply yet <span className="text-muted">{counts.data?.no_reply ?? ""}</span></> },
        ]} />
      </div>
      <div className="flex-1">
        {q.isPending ? <Skeleton lines={4} className="p-5" /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : q.data.items.length === 0 ? (
          <Empty>{tab === "urgent" ? "No urgent reviews in this period." : "Every poor review in this period has a reply."}</Empty>
        ) : (
          <ul>
            {q.data.items.map((r) => (
              <li key={r.id} className="border-b border-line-soft last:border-0">
                <button onClick={() => open(r.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper/60 sm:px-5">
                  <ScoreChip value={r.score} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{attentionText(r)}</span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {SHORT_NAMES[r.property]}, {day(r.reviewed_on)}. {tab === "urgent"
                        ? <span className="text-urgent-ink">{r.urgent_reason}</span>
                        : `Waiting ${plural(daysBetween(r.reviewed_on, today), "day")}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!!total && (
        <Link href={linkTo("/reviews", { view: tab })} className="border-t border-line-soft px-4 py-3 text-[13.5px] font-semibold text-accent sm:px-5">
          {total > 5 ? `See all ${total} in Reviews` : "Open in Reviews"}
        </Link>
      )}
    </Panel>
  );
}

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 13 };

function TrendPanel() {
  const { params, ready } = useParams();
  const [chart, setChart] = useState<"avg" | "mix">("avg");
  const q = useWeekly(params.property as string | undefined, params.to as string | undefined, params.from as string | undefined, ready);
  const rows = q.data?.buckets.map((b) => ({ ...b, label: short(b.bucket) })) ?? [];
  const weeks = rows.length;

  return (
    <Panel aria-labelledby="trend-h" className="xl:col-span-2">
      <PanelHeader id="trend-h" title={weeks > 12 ? `Weekly, last ${weeks} weeks` : "Last 12 weeks"}>
        <Tabs label="Chart" value={chart} onChange={setChart} options={[
          { value: "avg", label: "Average rating" },
          { value: "mix", label: "Positive and negative" },
        ]} />
      </PanelHeader>
      <div className="px-3 pb-4 sm:px-4">
        {q.isPending ? <Skeleton lines={6} className="p-2" /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : (
          <>
            <div className="h-48" role="img" aria-label={chart === "avg"
              ? `Weekly average rating. Latest week: ${score(rows.at(-1)?.avg_score)}`
              : `Reviews per week by type. Latest week: ${rows.at(-1)?.positive ?? 0} positive, ${rows.at(-1)?.mixed ?? 0} mixed, ${rows.at(-1)?.negative ?? 0} negative`}>
              <ResponsiveContainer>
                {chart === "avg" ? (
                  <LineChart data={rows} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...axis} />
                    <ReferenceLine y={6} stroke="var(--neg)" strokeDasharray="3 4" strokeOpacity={0.7} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [`${score(v as number)} from ${plural(item.payload.reviews, "review")}`, "Average"]} labelFormatter={(l) => `Week of ${l}`} />
                    <Line type="monotone" dataKey="avg_score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3.5, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                ) : (
                  <BarChart data={rows} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--line-soft)" }} labelFormatter={(l) => `Week of ${l}`} />
                    <Bar dataKey="negative" name="Negative" stackId="s" fill="var(--neg)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
                    <Bar dataKey="mixed" name="Mixed" stackId="s" fill="var(--mix)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
                    <Bar dataKey="positive" name="Positive" stackId="s" fill="var(--pos)" stroke="var(--surface)" strokeWidth={1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pt-1.5 text-[12.5px] text-muted">
              {chart === "avg" ? (
                <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-neg" aria-hidden />6.0: negative at or below. Gaps are weeks with no reviews.</span>
              ) : (
                <>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-pos" aria-hidden />Positive (8 to 10)</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-mix" aria-hidden />Mixed (above 6, below 8)</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-neg" aria-hidden />Negative (6 or below)</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function TopicBars() {
  const { params, ready } = useParams();
  const linkTo = useLinkTo();
  const q = useTopics(params, ready);
  const rows = [...(q.data?.topics ?? [])].sort((a, b) => (b.share_of_negative_reviews ?? 0) - (a.share_of_negative_reviews ?? 0));
  const max = Math.max(40, ...rows.flatMap((t) => [t.share_of_negative_reviews ?? 0, t.previous.share_of_negative_reviews ?? 0]));
  const scale = (v: number | null) => `${((v ?? 0) / max) * 100}%`;

  return (
    <Panel aria-labelledby="topic-h">
      <PanelHeader id="topic-h" title="What negative reviews mention" />
      {q.isPending ? <Skeleton lines={6} className="px-5 pb-5" /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : q.data.negative_reviews === 0 ? (
        <Empty>No negative reviews in this period.</Empty>
      ) : (
        <>
          <p className="px-4 pb-3 text-[12.5px] text-muted sm:px-5">
            Share of the {plural(q.data.negative_reviews, "negative review")} in this period. The tick shows the period before.
          </p>
          <ul className="space-y-1 px-2 pb-3 sm:px-3">
            {rows.map((t: TopicStat) => (
              <li key={t.topic}>
                <Link href={linkTo("/reviews", { topic: t.topic })} className="grid grid-cols-[100px_1fr_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] hover:bg-paper/70">
                  <span>{TOPIC_LABEL[t.topic]}</span>
                  <span className="relative h-2.5 rounded-full bg-line-soft">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-neg" style={{ width: scale(t.share_of_negative_reviews) }} />
                    {t.previous.share_of_negative_reviews != null && (
                      <span className="absolute -top-[3px] h-4 w-0.5 -translate-x-1/2 rounded-sm bg-ink" style={{ left: scale(t.previous.share_of_negative_reviews) }}
                        title={`Before: ${Math.round(t.previous.share_of_negative_reviews)}%`} />
                    )}
                  </span>
                  <span className="min-w-[84px] whitespace-nowrap text-right">
                    <strong className="font-semibold">{Math.round(t.share_of_negative_reviews ?? 0)}%</strong>{" "}
                    <span className="text-[12.5px] text-muted">{t.negative_reviews_mentioning} of {q.data.negative_reviews}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
