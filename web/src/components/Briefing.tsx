"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { api, ApiError, type Briefing } from "@/lib/api";
import { briefingParams, useFilters } from "@/lib/filters";
import { ago } from "@/lib/format";
import { useOpenReview } from "./ReviewDialog";
import { Skeleton } from "./ui";

const TEAM_LABEL: Record<string, string> = {
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  "front desk": "Front desk and check-in",
  management: "Management",
};

function useBriefing() {
  const [filters] = useFilters();
  const params = briefingParams(filters);
  return useQuery({
    queryKey: ["briefing", params],
    queryFn: () => api<Briefing>("briefing", params).then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.generating ? 5_000 : false),
    retry: (count, error) => !(error instanceof ApiError && error.status === 503) && count < 1,
  });
}

const Sparkle = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="flex-none text-accent">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);

/** One line of AI summary on the overview; the full briefing opens in a side panel. */
export function SummaryBar() {
  const q = useBriefing();
  const ref = useRef<HTMLDialogElement>(null);
  const b = q.data?.briefing;
  const shell = "flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5 sm:px-5";

  if (q.isPending) return <div className={shell}><Sparkle /><Skeleton lines={1} className="flex-1" /></div>;
  if (q.isError) {
    const noKey = q.error instanceof ApiError && q.error.status === 503;
    return (
      <div className={shell}>
        <Sparkle />
        <p className="flex-[1_1_420px] text-sm text-muted">
          {noKey
            ? "The AI summary needs an OpenAI key on the server (see README). All numbers and lists on this page work without it."
            : "The AI summary didn't load. The numbers below are not affected."}
        </p>
        {!noKey && <button onClick={() => q.refetch()} className="text-sm font-semibold text-accent">Try again</button>}
      </div>
    );
  }
  if (!b)
    return (
      <div className={shell} aria-live="polite">
        <Sparkle />
        <p className="flex-[1_1_420px] text-[15px] text-muted">Writing the AI summary for this period. It takes about 20 seconds the first time a period is opened.</p>
      </div>
    );

  return (
    <div className={shell} aria-live="polite">
      <Sparkle />
      <p className="flex-[1_1_480px] text-[15px] leading-snug">
        <strong className="font-semibold">{b.headline}</strong>
        {b.what_changed[0] && <> {b.what_changed[0].text}</>}
      </p>
      <button onClick={() => ref.current?.showModal()} className="whitespace-nowrap rounded-lg bg-accent px-3.5 py-2.5 text-sm font-semibold text-surface hover:opacity-90">
        Briefing and {b.actions.length} {b.actions.length === 1 ? "action" : "actions"}
      </button>
      <dialog
        ref={ref}
        aria-label="Briefing"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl bg-surface p-0 text-ink shadow-2xl sm:border-l sm:border-line"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-3">
            <p className="text-sm text-muted">AI briefing{q.data.generated_at ? `, written ${ago(q.data.generated_at)}` : ""}</p>
            <button onClick={() => ref.current?.close()} className="rounded-md px-2 py-1 text-sm font-semibold hover:bg-paper" autoFocus>Close</button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <BriefingBody data={q.data} />
          </div>
        </div>
      </dialog>
    </div>
  );
}

function BriefingBody({ data }: { data: Briefing }) {
  const open = useOpenReview();
  const b = data.briefing!;
  const cite = (ids: string[]) =>
    ids.length > 0 && (
      <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">
        {ids.map((id, i) => (
          <button key={id} onClick={() => open(id)} className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent hover:bg-accent-line">
            <span className="sr-only">Read review </span>{ids.length > 1 ? `review ${i + 1}` : "read review"}
          </button>
        ))}
      </span>
    );
  return (
    <article className="space-y-7">
      <div>
        <h2 className="text-2xl font-bold leading-tight tracking-tight">{b.headline}</h2>
        <p className="mt-2 text-[13px] text-muted">
          Written by AI from the reviews and the numbers on the dashboard. Numbers come from the database, not the AI. Each point links to the reviews behind it.
          {data.status === "stale" && (data.generating ? " New reviews have arrived; an updated briefing is being written." : " New reviews have arrived since it was written.")}
        </p>
      </div>
      <section>
        <h3 className="mb-3 text-[15px] font-semibold">What changed</h3>
        <ul className="space-y-3">
          {b.what_changed.map((p, i) => <li key={i} className="leading-relaxed">{p.text}{cite(p.review_ids)}</li>)}
        </ul>
      </section>
      <section>
        <h3 className="mb-3 text-[15px] font-semibold">Suggested actions</h3>
        <ul className="divide-y divide-line-soft rounded-xl border border-line">
          {b.actions.map((a, i) => (
            <li key={i} className="space-y-1 px-4 py-3.5">
              <p className="text-xs font-semibold text-accent">{TEAM_LABEL[a.team] ?? a.team}</p>
              <p className="leading-relaxed">{a.action}</p>
              <p className="text-[13px] text-muted">{a.why}{cite(a.review_ids)}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
