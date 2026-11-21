"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Coverage, type Run } from "@/lib/api";
import { ago, language, plural, SHORT_NAMES, until } from "@/lib/format";
import { useHealth } from "@/lib/queries";
import { Page } from "./PageHeader";
import { ErrorNote, Panel, PanelHeader, Skeleton } from "./ui";

const PROPERTY_STATUS = {
  ok: { label: "Up to date", cls: "bg-pos-soft text-pos-ink" },
  stale: { label: "Out of date", cls: "bg-mix-soft text-mix-ink" },
  failing: { label: "Failing", cls: "bg-urgent-soft text-urgent-ink" },
} as const;
const RUN_STATUS = {
  ok: { label: "Succeeded", cls: "bg-pos-soft text-pos-ink" },
  running: { label: "Running", cls: "bg-accent-soft text-accent" },
  failed: { label: "Failed", cls: "bg-urgent-soft text-urgent-ink" },
} as const;

const Badge = ({ s }: { s: { label: string; cls: string } }) => (
  <span className={`whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
);

/** The one thing to know first: is the data current, and if not, what to do. */
function StatusBanner({ health }: { health: NonNullable<ReturnType<typeof useHealth>["data"]> }) {
  const latest = Math.max(0, ...health.properties.map((p) => p.last_collected_at ?? 0));
  const bad = health.properties.filter((p) => p.status !== "ok");
  const rejected = health.properties.reduce((n, p) => n + p.rejected_reviews, 0);
  const tone = health.status === "ok" ? "border-pos/30 bg-pos-soft text-pos-ink" : health.status === "failing" ? "border-urgent/30 bg-urgent-soft text-urgent-ink" : "border-mix/40 bg-mix-soft text-mix-ink";
  const headline = health.status === "ok"
    ? "All four properties are up to date."
    : `${bad.map((p) => p.name).join(", ")} ${bad.length === 1 ? "is" : "are"} ${health.status === "failing" ? "failing to collect" : "out of date"}.`;
  const next = health.status === "ok"
    ? "The numbers on every page include all reviews collected so far."
    : health.status === "failing"
      ? "Numbers for those properties stop at their last successful collection. The error is shown in the table below; try collecting again, and if it keeps failing, Booking.com may have changed its page."
      : "Numbers for those properties may be missing recent reviews. Collect now, or check that the scheduled collection is running.";
  return (
    <div className={`rounded-xl border px-4 py-3.5 sm:px-5 ${tone}`} role="status">
      <p className="text-[15px] font-semibold">{headline}</p>
      <p className="mt-0.5 text-sm text-ink">{next}</p>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span>Last collected {ago(latest || null)}</span>
        <span>
          {health.schedule.running ? "Collecting now"
            : health.schedule.every_hours && health.schedule.next_at
              ? `Collects automatically every ${health.schedule.every_hours} hours, next ${until(health.schedule.next_at)}`
              : "Automatic collection is off"}
        </span>
        <span>{health.reviews.toLocaleString("en-AU")} reviews stored</span>
        <span>{health.with_text.toLocaleString("en-AU")} with written text</span>
        <span>{rejected ? `${rejected} rejected by validation` : "None rejected by validation"}</span>
      </p>
    </div>
  );
}

const th = "px-4 py-2 text-left text-xs font-medium text-muted sm:px-5";
const td = "border-t border-line-soft px-4 py-2.5 align-top sm:px-5";

export function HealthPage() {
  const health = useHealth();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Run[]>("runs", { limit: 12 }).then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 5_000 : 60_000),
  });
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => api<Coverage>("coverage").then((r) => r.data) });
  const collect = useMutation({
    mutationFn: () => fetch("/api/collect", { method: "POST" }).then(async (r) => {
      if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null))?.detail ?? `The server answered ${r.status}`);
    }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["runs"] }), 2_000),
  });
  const running = runs.data?.some((r) => r.status === "running");
  const h = health.data;

  return (
    <Page>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Data health</h1>
          <p className="mt-0.5 text-[13px] text-muted">Where the reviews come from, when they were last collected, and whether anything is failing.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={() => collect.mutate()} disabled={collect.isPending || running}
            className="rounded-lg bg-btn px-3.5 py-2.5 text-sm font-semibold text-btn-ink hover:opacity-90 disabled:opacity-50">
            {running ? "Collecting…" : collect.isPending ? "Starting…" : "Collect new reviews now"}
          </button>
          <p className="text-xs text-muted" aria-live="polite">
            {collect.isError ? (collect.error as Error).message : collect.isSuccess && !running ? "Started. Progress appears below." : "Also runs automatically. Opens a browser window on the server machine."}
          </p>
        </div>
      </header>

      {h && <StatusBanner health={h} />}

      <Panel aria-labelledby="src-h">
        <PanelHeader id="src-h" title="Collection by property">
          {h && `Marked out of date after ${h.stale_after_hours} hours without a successful collection`}
        </PanelHeader>
        {health.isPending ? <Skeleton lines={4} className="px-5 pb-5" /> : health.isError ? <ErrorNote error={health.error} retry={health.refetch} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead><tr><th className={th}>Property</th><th className={th}>Status</th><th className={th}>Last collected</th><th className={th}>Reviews stored</th><th className={th}>Rejected</th><th className={th}>Last error</th></tr></thead>
              <tbody>
                {h!.properties.map((p) => (
                  <tr key={p.property}>
                    <td className={`${td} font-semibold`}>{p.name}</td>
                    <td className={td}><Badge s={PROPERTY_STATUS[p.status]} /></td>
                    <td className={td}>{ago(p.last_collected_at)}</td>
                    <td className={td}>
                      {p.stored_reviews.toLocaleString("en-AU")}
                      {p.reported_reviews != null && (
                        <span className="text-muted"> of {p.reported_reviews.toLocaleString("en-AU")} on Booking.com{p.stored_reviews < p.reported_reviews ? " (newest kept)" : ""}</span>
                      )}
                    </td>
                    <td className={td}>{p.rejected_reviews ? <span className="text-warn">{p.rejected_reviews}</span> : <span className="text-muted">0</span>}</td>
                    <td className={`${td} max-w-xs text-[13px] ${p.last_error ? "text-urgent-ink" : "text-muted"}`}>{p.last_error ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 pb-3.5 pt-2 text-[12.5px] leading-relaxed text-muted sm:px-5">
          Reviews are read from each property&apos;s public Booking.com page, newest first. A run stops at the first review it already has, so nothing is stored twice.
          A review that fails validation (no id, a score outside 1 to 10, an impossible date) is rejected and logged instead of stored. &ldquo;Newest kept&rdquo; means the run was capped at 100 pages (1,000 reviews).
        </p>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel aria-labelledby="runs-h">
          <PanelHeader id="runs-h" title="Recent collection runs">Newest first. &ldquo;New&rdquo; is reviews not seen before.</PanelHeader>
          {runs.isPending ? <Skeleton lines={6} className="px-5 pb-5" /> : runs.isError ? <ErrorNote error={runs.error} retry={runs.refetch} /> : runs.data.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">No runs recorded yet. The sample data includes the last successful run for each property.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead><tr><th className={th}>Property</th><th className={th}>Started</th><th className={th}>Status</th><th className={`${th} text-right`}>Pages</th><th className={`${th} text-right`}>Seen</th><th className={`${th} text-right`}>New</th></tr></thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.id}>
                      <td className={`${td} whitespace-nowrap`}>{SHORT_NAMES[r.property] ?? r.property}</td>
                      <td className={`${td} whitespace-nowrap`}>{ago(r.started_at)}</td>
                      <td className={td}>
                        <Badge s={RUN_STATUS[r.status as keyof typeof RUN_STATUS] ?? RUN_STATUS.failed} />
                        {r.error && <p className="mt-1 text-xs text-urgent-ink">{r.error}</p>}
                      </td>
                      <td className={`${td} text-right`}>{r.pages}</td>
                      <td className={`${td} text-right`}>{r.seen}</td>
                      <td className={`${td} text-right font-semibold`}>{r.new}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel aria-labelledby="ai-h">
          <PanelHeader id="ai-h" title="AI analysis and languages" />
          {!h || coverage.isPending ? <Skeleton lines={6} className="px-5 pb-5" /> : coverage.isError ? <ErrorNote error={coverage.error} retry={coverage.refetch} /> : (
            <div className="space-y-4 px-4 pb-4 sm:px-5">
              <p className="text-sm leading-relaxed">
                <strong className="font-semibold">{h.analysed.toLocaleString("en-AU")} of {plural(h.with_text, "written review")}</strong> have been read by the AI (translated and tagged).{" "}
                {h.llm_enabled ? "New reviews are analysed after each collection." : "No OpenAI key is set, so new reviews are tagged with keyword rules (English only) until one is added."}
              </p>
              <p className="text-sm text-muted">
                {coverage.data.non_english_with_text.toLocaleString("en-AU")} written reviews ({Math.round(coverage.data.non_english_pct ?? 0)}%) are not in English. They are translated, so they count in every number.
              </p>
              <ul className="space-y-1.5">
                {coverage.data.languages.filter((l) => l.with_text > 0).slice(0, 8).map((l) => (
                  <li key={l.lang} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,140px)_44px] items-center gap-3 text-[13px]">
                    <span className="truncate">{language(l.lang)}</span>
                    <span className="h-1.5 rounded-full bg-line-soft" aria-hidden>
                      <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${(l.with_text / coverage.data.with_text) * 100}%` }} />
                    </span>
                    <span className="text-right text-muted">{l.with_text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </Page>
  );
}
