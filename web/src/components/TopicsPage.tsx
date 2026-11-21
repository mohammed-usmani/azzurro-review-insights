"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { api, type TopicStat, type Topics } from "@/lib/api";
import { useLinkTo } from "@/lib/filters";
import { plural, PROPERTIES, SHORT_NAMES, TOPIC_LABEL } from "@/lib/format";
import { useParams, useProblems, useTopics } from "@/lib/queries";
import { Page, PageHeader } from "./PageHeader";
import { Empty, ErrorNote, Panel, PanelHeader, Skeleton } from "./ui";

const round = (n: number | null | undefined) => Math.round(n ?? 0);

export function TopicsPage() {
  const { params, ready } = useParams();
  const topics = useTopics(params, ready);
  const extra = topics.data ? `${plural(topics.data.reviews, "review")}, ${topics.data.negative_reviews} negative` : undefined;
  return (
    <Page>
      <PageHeader title="Topics and problems" compare extra={extra} />
      {ready && (
        <>
          {topics.isPending ? <Panel><Skeleton lines={3} className="p-5" /></Panel>
            : topics.isError ? <Panel><ErrorNote error={topics.error} retry={topics.refetch} /></Panel>
            : <InsightStrip data={topics.data} />}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Heatmap />
            <Problems />
          </div>
          <p className="max-w-[110ch] text-[12.5px] leading-relaxed text-muted">
            How this is measured: an AI model reads every review in its own language and lists each thing the guest praises or complains about, with its topic.
            Checked against 50 hand-labelled reviews, it is right 90% of the time when it tags a topic and finds 78% of mentions. Problems are grouped by meaning,
            so &ldquo;bathroom filthy&rdquo; and &ldquo;dirty shared toilets&rdquo; count as one. Negative means a score of 6 or below.
          </p>
        </>
      )}
    </Page>
  );
}

function change(now: number | null, before: number | null) {
  if (before == null) return { text: "No earlier data", cls: "text-muted" };
  const d = round(now) - round(before);
  if (Math.abs(d) <= 1) return { text: `About the same as before (${round(before)}%)`, cls: "text-muted" };
  return d > 0 ? { text: `Up from ${round(before)}%`, cls: "text-neg-ink" } : { text: `Down from ${round(before)}%`, cls: "text-pos-ink" };
}

function InsightStrip({ data }: { data: Topics }) {
  const worst = [...data.topics].filter((t) => t.negative_reviews_mentioning > 0)
    .sort((a, b) => (b.share_of_negative_reviews ?? 0) - (a.share_of_negative_reviews ?? 0)).slice(0, 3);
  const best = [...data.topics].sort((a, b) => b.praised - a.praised)[0];
  const cell = "min-w-0 bg-surface px-4 py-4 sm:px-5";
  if (!worst.length && !best?.praised) return <Panel><Empty>No written reviews mention any topic in this period.</Empty></Panel>;
  return (
    <Panel aria-label="Insights" className="grid grid-cols-2 gap-px overflow-hidden bg-line-soft sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      {worst.map((t: TopicStat) => {
        const c = change(t.share_of_negative_reviews, t.previous.share_of_negative_reviews);
        return (
          <div key={t.topic} className={cell}>
            <p className="text-[28px] font-bold leading-tight tracking-tight">{round(t.share_of_negative_reviews)}%</p>
            <p className="mt-0.5 text-sm leading-snug">of negative reviews mentioned <strong className="font-semibold">{TOPIC_LABEL[t.topic].toLowerCase()}</strong></p>
            <p className={`mt-1 text-[12.5px] ${c.cls}`}>{c.text}. {t.negative_reviews_mentioning} of {data.negative_reviews} reviews</p>
          </div>
        );
      })}
      {best?.praised > 0 && (
        <div className={cell}>
          <p className="text-[28px] font-bold leading-tight tracking-tight text-pos-ink">{round(best.praise_rate)}%</p>
          <p className="mt-0.5 text-sm leading-snug">of all reviews <strong className="font-semibold">praised {TOPIC_LABEL[best.topic].toLowerCase()}</strong></p>
          <p className="mt-1 text-[12.5px] text-muted">{best.praised} of {data.reviews} reviews</p>
        </div>
      )}
    </Panel>
  );
}

const HEAT = [
  { max: 0, bg: "var(--heat-0)", fg: "var(--heat-ink-0)", label: "None" },
  { max: 10, bg: "var(--heat-1)", fg: "var(--heat-ink)", label: "Under 10%" },
  { max: 20, bg: "var(--heat-2)", fg: "var(--heat-ink)", label: "10 to 20%" },
  { max: 30, bg: "var(--heat-3)", fg: "var(--heat-ink)", label: "20 to 30%" },
  { max: Infinity, bg: "var(--heat-4)", fg: "var(--heat-ink-4)", label: "30% or more" },
];
const heat = (p: number) => HEAT.find((h, i) => (i === 0 ? p === 0 : p < h.max)) ?? HEAT[4];

/** Topic × property grid. Always shows all four properties so they can be compared. */
function Heatmap() {
  const { params, ready } = useParams();
  const linkTo = useLinkTo();
  const slugs = ["", ...PROPERTIES.map((p) => p.slug)];
  const results = useQueries({
    queries: slugs.map((slug) => {
      const qp = { from: params.from, to: params.to, property: slug || undefined };
      return { queryKey: ["topics", qp], queryFn: () => api<Topics>("topics", qp).then((r) => r.data), enabled: ready };
    }),
  });
  const cols = slugs.map((slug, i) => ({ slug, name: slug ? SHORT_NAMES[slug] : "All", q: results[i] }));
  const all = cols[0].q;
  const loading = cols.some((c) => c.q.isPending);
  const failed = cols.find((c) => c.q.isError);
  const order = [...(all.data?.topics ?? [])].sort((a, b) => (b.share_of_negative_reviews ?? 0) - (a.share_of_negative_reviews ?? 0));
  const href = (slug: string, topic: string) => {
    const url = new URL(linkTo("/reviews", { topic }), "http://x");
    if (slug) url.searchParams.set("property", slug); else url.searchParams.delete("property");
    return url.pathname + url.search;
  };

  return (
    <Panel aria-labelledby="heat-h">
      <PanelHeader id="heat-h" title="Complaints by topic and property">Click a cell to read those reviews</PanelHeader>
      <p className="px-4 pb-2 text-[12.5px] text-muted sm:px-5">Share of each property&apos;s negative reviews that complain about the topic. The small number is the count of reviews.</p>
      {loading ? <Skeleton lines={8} className="px-5 pb-5" /> : failed ? <ErrorNote error={failed.q.error} retry={failed.q.refetch} /> : (
        <div className="overflow-x-auto px-3 pb-1 sm:px-4">
          <table className="w-full min-w-[560px] border-separate border-spacing-[3px]">
            <thead>
              <tr>
                <th scope="col" className="px-1.5 text-left align-bottom text-xs font-medium text-muted">Topic</th>
                {cols.map((c) => (
                  <th key={c.slug} scope="col" className={`px-1 align-bottom text-xs font-medium ${params.property === c.slug ? "text-ink" : "text-muted"}`}>
                    {c.name}<br /><span className="font-normal">{c.q.data!.negative_reviews} negative</span>
                  </th>
                ))}
                <th scope="col" className="px-1 align-bottom text-xs font-medium text-muted">vs before</th>
              </tr>
            </thead>
            <tbody>
              {order.map((t) => {
                const now = t.share_of_negative_reviews, before = t.previous.share_of_negative_reviews;
                const d = before == null ? null : round(now) - round(before);
                return (
                  <tr key={t.topic}>
                    <th scope="row" className="whitespace-nowrap pr-2.5 text-left text-[13.5px] font-medium">{TOPIC_LABEL[t.topic]}</th>
                    {cols.map((c) => {
                      const s = c.q.data!.topics.find((x) => x.topic === t.topic)!;
                      const p = round(s.share_of_negative_reviews), n = s.negative_reviews_mentioning;
                      const h = heat(p);
                      const name = c.slug ? SHORT_NAMES[c.slug] : "all properties";
                      return (
                        <td key={c.slug} className="p-0">
                          <Link href={href(c.slug, t.topic)} style={{ background: h.bg, color: h.fg }}
                            aria-label={`${TOPIC_LABEL[t.topic]}, ${name}: ${p}% of negative reviews, ${n} ${n === 1 ? "review" : "reviews"}`}
                            className={`flex h-[46px] min-w-[72px] flex-col items-center justify-center rounded-[7px] text-sm hover:outline-2 hover:outline-ink ${c.slug === "" ? "ring-[1.5px] ring-ink ring-inset" : ""}`}>
                            <span className="font-semibold">{p}%</span>
                            {n > 0 && <span className="text-[11px] opacity-80">{n}</span>}
                          </Link>
                        </td>
                      );
                    })}
                    <td className={`whitespace-nowrap px-1.5 text-center text-[13px] font-medium ${d == null || d === 0 ? "text-muted" : d > 0 ? "text-neg-ink" : "text-pos-ink"}`}>
                      {d == null ? "–" : d === 0 ? "same" : <><span aria-hidden>{d > 0 ? "▲" : "▼"}</span><span className="sr-only">{d > 0 ? "up" : "down"}</span> {Math.abs(d)} {Math.abs(d) === 1 ? "pt" : "pts"}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-4 pb-3.5 pt-2 text-[12.5px] text-muted sm:px-5">
        {HEAT.map((h) => (
          <span key={h.label} className="flex items-center gap-1"><span className="h-3 w-4 rounded-[3px]" style={{ background: h.bg }} aria-hidden />{h.label}</span>
        ))}
      </div>
    </Panel>
  );
}

function Problems() {
  const { params, ready } = useParams();
  const linkTo = useLinkTo();
  const q = useProblems({ ...params, limit: 10 }, ready);
  const max = Math.max(1, ...(q.data?.issues.map((i) => i.reviews) ?? []));
  return (
    <Panel aria-labelledby="prob-h">
      <PanelHeader id="prob-h" title="Most common problems">Reviews, vs the period before</PanelHeader>
      {q.isPending ? <Skeleton lines={8} className="px-5 pb-5" /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : q.data.issues.length === 0 ? (
        <Empty>No problems reported in this period.</Empty>
      ) : (
        <ul>
          {q.data.issues.map((p) => {
            const serious = p.max_severity >= 3;
            const where = Object.entries(p.by_property).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${SHORT_NAMES[k]} ${n}`).join(", ");
            return (
              <li key={p.id} className="border-t border-line-soft">
                <Link href={linkTo("/reviews", { group: p.id, glabel: p.label })} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,120px)_76px] items-center gap-3.5 px-4 py-2.5 hover:bg-paper/60 sm:px-5">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold first-letter:uppercase">
                      {p.label}
                      {serious && <span className="rounded-[5px] bg-urgent-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-urgent-ink">Serious</span>}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">{p.topic_label}: {where}</span>
                  </span>
                  <span className="h-2 rounded-full bg-line-soft" aria-hidden>
                    <span className={`block h-2 rounded-full ${serious ? "bg-[var(--heat-4)]" : "bg-[var(--heat-3)]"}`} style={{ width: `${(p.reviews / max) * 100}%` }} />
                  </span>
                  <span className="text-right text-sm">
                    <strong className="font-semibold">{p.reviews}</strong>{" "}
                    <span className={`text-[12.5px] ${p.reviews > p.previous_reviews ? "text-neg-ink" : "text-muted"}`}>from {p.previous_reviews}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
