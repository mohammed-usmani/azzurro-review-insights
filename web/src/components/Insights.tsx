"use client";

import type { Problems, Topics } from "@/lib/api";
import { plural, score, SHORT_NAMES } from "@/lib/format";
import { Empty } from "./ui";

/** Topic sentences and the topic table, then the specific problems behind them. */
export function TopicInsights({ data, onTopic }: { data: Topics; onTopic: (topic: string) => void }) {
  const rows = [...data.topics].sort((a, b) => b.complained - a.complained || b.praised - a.praised);
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div>
        {data.insights.length ? (
          <ul className="space-y-3">
            {data.insights.map((s) => (
              <li key={s} className="text-lg leading-snug">{s}.</li>
            ))}
          </ul>
        ) : (
          <Empty>No reviews in this period yet.</Empty>
        )}
        <p className="mt-4 max-w-prose text-sm text-muted">
          A review counts for a topic when the guest praises or complains about it. Reviews in other languages are translated
          first. &ldquo;Negative reviews&rdquo; are those scored 6 or below ({data.negative_reviews} in this period).
        </p>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Topic</th>
              <th className="py-2 text-right font-normal">Complaints</th>
              <th className="py-2 text-right font-normal">Before</th>
              <th className="py-2 text-right font-normal">Praise</th>
              <th className="py-2 pl-3 text-right font-normal" title="Average score of reviews that complain about this topic">Avg score when complained about</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.topic} className="border-b border-line">
                <td className="py-2">
                  <button onClick={() => onTopic(t.topic)} className="font-medium hover:text-accent hover:underline">{t.label}</button>
                </td>
                <td className="py-2 text-right">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-1.5 rounded-full bg-neg" style={{ width: `${Math.min(64, t.complained * 4)}px` }} />
                    {t.complained}
                  </span>
                </td>
                <td className="py-2 text-right text-muted">{t.previous.complained}</td>
                <td className="py-2 text-right">{t.praised}</td>
                <td className="py-2 pl-3 text-right">{t.complained ? score(t.avg_score_when_complained) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-faint">Click a topic to read those reviews. Overall average this period: {score(data.avg_score)}.</p>
      </div>
    </div>
  );
}

export function TopProblems({ data, onProblem }: { data: Problems; onProblem: (id: number, label: string) => void }) {
  if (!data.issues.length) return <Empty>No complaints in this period.</Empty>;
  const max = Math.max(...data.issues.map((i) => i.reviews));
  return (
    <ol className="divide-y divide-line">
      {data.issues.map((p) => (
        <li key={p.id}>
          <button onClick={() => onProblem(p.id, p.label)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 text-left hover:bg-surface sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
            <span>
              <span className="font-medium first-letter:uppercase">{p.label}</span>
              {p.max_severity === 3 && <span className="ml-2 rounded bg-urgent-soft px-1.5 py-0.5 text-xs font-medium text-urgent">serious</span>}
              <span className="block text-sm text-muted">
                {p.topic_label}: {Object.entries(p.by_property).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${SHORT_NAMES[k]} ${n}`).join(", ")}
              </span>
            </span>
            <span aria-hidden className="hidden h-2 rounded-full bg-neg/80 sm:block" style={{ width: `${(p.reviews / max) * 100}%` }} />
            <span className="text-right text-sm">
              <span className="font-semibold">{plural(p.reviews, "review")}</span>
              <span className="block text-muted">{p.previous_reviews} before</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

