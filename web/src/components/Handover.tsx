"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Briefing } from "@/lib/api";
import { useOpenReview } from "./ReviewDialog";
import { ErrorNote, Skeleton } from "./ui";

const TEAM_LABEL: Record<string, string> = {
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  "front desk": "Front desk / check-in",
  management: "Management",
};

/** The AI briefing. Served from storage; while a new one is being written the old one stays visible. */
export function Handover({ params, periodLabel }: { params: Record<string, string | undefined>; periodLabel: string }) {
  const q = useQuery({
    queryKey: ["briefing", params],
    queryFn: () => api<Briefing>("briefing", params).then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.generating ? 5_000 : false),
  });
  const open = useOpenReview();

  if (q.isPending) return <Skeleton lines={4} />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 503)
      return <p className="text-muted">The written summary needs an OpenAI key on the server. Everything else on this page works without it.</p>;
    return <ErrorNote error={q.error} retry={q.refetch} />;
  }
  const b = q.data.briefing;
  if (!b)
    return (
      <div aria-live="polite">
        <p className="text-2xl font-semibold leading-snug text-muted">Writing the summary for this period…</p>
        <p className="mt-2 text-sm text-muted">This takes about 20 seconds the first time a period is opened. The numbers below are already up to date.</p>
      </div>
    );

  const cite = (ids: string[]) =>
    ids.length > 0 && (
      <span className="text-sm text-muted">
        {" "}
        {ids.map((id, i) => (
          <button key={id} onClick={() => open(id)} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
            {i === 0 ? `read review${ids.length > 1 ? "s" : ""} ${i + 1}` : i + 1}
          </button>
        )).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
      </span>
    );

  return (
    <div aria-live="polite">
      <p className="mb-2 text-sm text-muted">
        Summary of {periodLabel}, written by AI from the reviews and numbers on this page.
        {q.data.status === "stale" && (q.data.generating ? " New reviews have arrived; an updated summary is being written." : " New reviews have arrived since it was written.")}
      </p>
      <p className="max-w-[46ch] text-[1.65rem] font-semibold leading-tight tracking-tight sm:text-3xl">{b.headline}</p>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">What changed</h3>
          <ul className="space-y-2.5">
            {b.what_changed.map((p, i) => (
              <li key={i} className="leading-relaxed">{p.text}{cite(p.review_ids)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Suggested actions</h3>
          <ul className="space-y-3">
            {b.actions.map((a, i) => (
              <li key={i}>
                <p className="text-sm font-semibold text-accent">{TEAM_LABEL[a.team] ?? a.team}</p>
                <p className="leading-relaxed">{a.action}</p>
                <p className="text-sm text-muted">{a.why}{cite(a.review_ids)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
