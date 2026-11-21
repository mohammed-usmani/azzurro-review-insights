"use client";

import type { Overview, Window } from "@/lib/api";
import { plural, range, score } from "@/lib/format";
import { Change } from "./ui";

/** Average rating for the period vs the previous one, then property by property. */
export function Ratings({ data }: { data: Overview }) {
  const { current: cur, previous: prev, period } = data;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <div>
        <p className="text-sm text-muted">Average rating, {range(period.from, period.to)}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-6xl font-semibold tracking-tight">{score(cur.avg_score)}</span>
          <span className="text-muted">/ 10</span>
        </p>
        <p className="mt-1">
          <Change value={data.avg_change} /> <span className="text-muted">from {score(prev.avg_score)} {period.previous_label}</span>
        </p>
        <p className="mt-3 text-sm text-muted">
          From {plural(cur.reviews, "review")} ({prev.reviews} {period.previous_label}).
          {cur.reviews > 0 && cur.reviews < 10 && " With this few reviews, one guest can move the average a lot."}
        </p>
        <SentimentBar w={cur} />
      </div>

      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left">
          <thead className="text-sm text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Property</th>
              <th className="py-2 text-right font-normal">This period</th>
              <th className="py-2 text-right font-normal">Before</th>
              <th className="py-2 pl-4 font-normal">Change</th>
              <th className="py-2 text-right font-normal">Reviews</th>
              <th className="py-2 pl-4 font-normal">Poor reviews</th>
            </tr>
          </thead>
          <tbody>
            {[...data.by_property]
              .sort((a, b) => (a.current.avg_score ?? 11) - (b.current.avg_score ?? 11))
              .map((p) => (
                <tr key={p.property} className="border-b border-line">
                  <td className="py-3 font-medium">{p.name}</td>
                  <td className="py-3 text-right text-lg font-semibold">{score(p.current.avg_score)}</td>
                  <td className="py-3 text-right text-muted">{score(p.previous.avg_score)}</td>
                  <td className="py-3 pl-4 text-sm"><Change value={p.avg_change} /></td>
                  <td className="py-3 text-right">{p.current.reviews}</td>
                  <td className="py-3 pl-4 text-sm text-muted">{p.current.reviews ? `${p.current.negative} of ${p.current.reviews}` : "–"}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-faint">Lowest average first. &ldquo;Poor&rdquo; means a score of 6 or below.</p>
      </div>
    </div>
  );
}

function SentimentBar({ w }: { w: Window }) {
  if (!w.reviews) return null;
  const parts = [
    { key: "Positive (8–10)", n: w.positive, cls: "bg-pos" },
    { key: "Mixed", n: w.mixed, cls: "bg-mix" },
    { key: "Poor (6 or below)", n: w.negative, cls: "bg-neg" },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img"
        aria-label={parts.map((p) => `${p.key}: ${p.n}`).join(", ")}>
        {parts.filter((p) => p.n).map((p) => (
          <div key={p.key} className={p.cls} style={{ flexGrow: p.n }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${p.cls}`} />{p.key}: {p.n}</li>
        ))}
      </ul>
    </div>
  );
}
