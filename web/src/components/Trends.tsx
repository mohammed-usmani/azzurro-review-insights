"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Trends as TrendData } from "@/lib/api";
import { day, score } from "@/lib/format";

const axis = { stroke: "var(--faint)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)", fontSize: 13 };

/** Two charts with one axis each (never a dual-axis chart): weekly average, and weekly review counts by type. */
export function Trends({ data }: { data: TrendData }) {
  const rows = data.buckets.map((b) => ({ ...b, label: day(b.bucket) }));
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <figure>
        <figcaption className="mb-2 text-sm font-medium">Average rating per week</figcaption>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [score(v as number), "Average"]} labelFormatter={(l) => `Week of ${l}`} />
              <Line type="monotone" dataKey="avg_score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-faint">Gaps are weeks with no reviews.</p>
      </figure>
      <figure>
        <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
          Positive and negative reviews per week
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted"><span className="size-2 rounded-full bg-pos" />Positive (8–10)</span>
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted"><span className="size-2 rounded-full bg-mix" />Mixed</span>
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted"><span className="size-2 rounded-full bg-neg" />Negative (6 or below)</span>
        </figcaption>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--line)", opacity: 0.4 }} labelFormatter={(l) => `Week of ${l}`} />
              <Bar dataKey="negative" name="Negative" stackId="s" fill="var(--neg)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
              <Bar dataKey="mixed" name="Mixed" stackId="s" fill="var(--mix)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
              <Bar dataKey="positive" name="Positive" stackId="s" fill="var(--pos)" stroke="var(--surface)" strokeWidth={1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
