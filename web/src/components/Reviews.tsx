"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, type Review, type ReviewPage } from "@/lib/api";
import { day, plural, SHORT_NAMES, TOPIC_LABEL, TOPICS } from "@/lib/format";
import { useCounts, useParams } from "@/lib/queries";
import { Page, PageHeader } from "./PageHeader";
import { ReviewDetail, useOpenReview, useReview } from "./ReviewDialog";
import { Empty, ErrorNote, Panel, ScoreChip, Skeleton } from "./ui";

type View = "all" | "urgent" | "reply" | "negative" | "translated";
const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "reply", label: "No reply yet" },
  { value: "negative", label: "Negative" },
  { value: "translated", label: "Translated" },
];
const PAGE = 20;

/** Wide screens show the reading pane beside the list; narrow ones open reviews in the side panel. */
function useWide() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia("(min-width: 1024px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

/** Review-page state lives in the URL next to property and period, so any view can be shared. */
function useReviewState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = useCallback((next: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(sp);
    Object.entries(next).forEach(([k, v]) => (v ? qs.set(k, v) : qs.delete(k)));
    router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);
  const view = (VIEWS.some((v) => v.value === sp.get("view")) ? sp.get("view") : "all") as View;
  return {
    view, set,
    topic: sp.get("topic") ?? "",
    q: sp.get("q") ?? "",
    sort: sp.get("sort") ?? "newest",
    group: sp.get("group") ?? "",
    groupLabel: sp.get("glabel") ?? "",
    review: sp.get("review"),
    scoreOnly: sp.get("all") === "1",
  };
}

export function Reviews() {
  const { params, ready } = useParams();
  const s = useReviewState();
  const wide = useWide();
  const openDialog = useOpenReview();
  const counts = useCounts({ ...params, has_text: !s.scoreOnly }, ready);
  const written = useCounts({ ...params, has_text: true }, ready);
  const everything = useCounts({ ...params, has_text: false }, ready);
  const scoreOnlyCount = written.data && everything.data ? everything.data.all - written.data.all : null;
  const [search, setSearch] = useState(s.q);

  useEffect(() => {
    const t = setTimeout(() => search !== s.q && s.set({ q: search || undefined, review: undefined }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = s.scoreOnly ? undefined : true;
  const query = {
    ...params,
    urgent: s.view === "urgent" || undefined,
    sentiment: s.view === "reply" || s.view === "negative" ? "negative" : undefined,
    replied: s.view === "reply" ? false : undefined,
    has_text: s.view === "reply" ? true : text,
    translated: s.view === "translated" || undefined,
    topic: s.topic || undefined, polarity: s.topic ? "negative" : undefined,
    issue_group: s.group || undefined,
    q: s.q || undefined,
    sort: s.sort,
  };
  const list = useInfiniteQuery({
    queryKey: ["reviews", "list", query],
    queryFn: ({ pageParam }) => api<ReviewPage>("reviews", { ...query, limit: PAGE, offset: pageParam }).then((r) => r.data),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.limit < last.total ? last.offset + last.limit : undefined),
    enabled: ready,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const selected = s.review ?? (wide ? items[0]?.id ?? null : null);

  const pick = (id: string) => (wide ? s.set({ review: id }) : openDialog(id));
  const reset = { review: undefined };

  const active = [
    s.topic && { label: `Complaints about ${TOPIC_LABEL[s.topic]?.toLowerCase()}`, clear: { topic: undefined } },
    s.group && { label: `Problem: ${s.groupLabel || "selected problem"}`, clear: { group: undefined, glabel: undefined } },
    s.q && { label: `Search: "${s.q}"`, clear: { q: undefined }, onClear: () => setSearch("") },
  ].filter(Boolean) as { label: string; clear: Record<string, undefined>; onClear?: () => void }[];

  return (
    <Page>
      <PageHeader title="Reviews" />
      {ready && (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => {
                const n = counts.data ? (v.value === "reply" ? counts.data.no_reply : counts.data[v.value]) : undefined;
                const on = s.view === v.value;
                return (
                  <button key={v.value} aria-pressed={on} onClick={() => s.set({ view: v.value === "all" ? undefined : v.value, ...reset })}
                    className={`rounded-full border px-3 py-1.5 text-[13px] ${on ? "border-ink bg-ink font-semibold text-surface" : "border-line bg-surface hover:border-muted"}`}>
                    {v.label} {n !== undefined && <span className="opacity-70">{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className="hidden flex-1 xl:block" />
            <label className="relative flex items-center">
              <span className="sr-only">Search reviews</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="absolute left-2.5 text-muted"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, in any language"
                className="h-9 w-56 rounded-lg border border-line bg-surface pl-8 pr-2.5 text-[13.5px]" />
            </label>
            <label>
              <span className="sr-only">Complaints about</span>
              <select value={s.topic} onChange={(e) => s.set({ topic: e.target.value || undefined, ...reset })} className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13.5px]">
                <option value="">Any topic</option>
                {TOPICS.map((t) => <option key={t.value} value={t.value}>Complaints about {t.label.toLowerCase()}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Sort</span>
              <select value={s.sort} onChange={(e) => s.set({ sort: e.target.value === "newest" ? undefined : e.target.value, ...reset })} className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13.5px]">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="lowest">Lowest score first</option>
                <option value="highest">Highest score first</option>
              </select>
            </label>
          </div>

          {active.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Active filters">
              {active.map((a) => (
                <li key={a.label}>
                  <button onClick={() => { a.onClear?.(); s.set({ ...a.clear, ...reset }); }} className="rounded-full bg-accent-soft px-3 py-1 text-[13px] text-accent hover:bg-accent-line">
                    {a.label} <span aria-hidden>×</span><span className="sr-only"> (remove this filter)</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Panel aria-label="Review list" className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5 text-[12.5px] text-muted">
                <span aria-live="polite">{list.data ? plural(total, "review") : "Loading reviews"}</span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={s.scoreOnly} onChange={(e) => s.set({ all: e.target.checked ? "1" : undefined, ...reset })} />
                  {scoreOnlyCount == null ? "Also show reviews with only a score" : `Also show ${plural(scoreOnlyCount, "review")} with only a score`}
                </label>
              </div>
              {list.isPending ? <Skeleton lines={8} className="p-4" /> : list.isError ? <ErrorNote error={list.error} retry={list.refetch} /> : items.length === 0 ? (
                <Empty>No reviews match. Try a longer period, another property, or remove a filter.</Empty>
              ) : (
                <>
                  <ul>
                    {items.map((r) => <ListItem key={r.id} review={r} current={r.id === selected} onPick={() => pick(r.id)} />)}
                  </ul>
                  <div className="flex items-center justify-between border-t border-line-soft px-4 py-3 text-[12.5px] text-muted">
                    <span>Showing {items.length} of {total}</span>
                    {list.hasNextPage && (
                      <button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="font-semibold text-accent disabled:text-muted">
                        {list.isFetchingNextPage ? "Loading…" : `Load ${Math.min(PAGE, total - items.length)} more`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </Panel>
            {wide && (
              <div className="lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)] lg:overflow-y-auto lg:rounded-xl">
                <Pane id={selected} />
              </div>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

function ListItem({ review: r, current, onPick }: { review: Review; current: boolean; onPick: () => void }) {
  const title = r.title_en ?? r.title;
  const disliked = r.negative_en ?? r.negative;
  const liked = r.positive_en ?? r.positive;
  const snippet = disliked ? `Disliked: ${disliked}` : liked ? `Liked: ${liked}` : "Score only, no written review";
  const translated = Boolean(r.title_en || r.positive_en || r.negative_en);
  return (
    <li className="border-b border-line-soft last:border-0">
      <button onClick={onPick} aria-current={current || undefined}
        className={`flex w-full gap-3 px-4 py-3 text-left ${current ? "bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-paper/60"}`}>
        <ScoreChip value={r.score} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2.5">
            <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${title ? "" : "text-muted"}`}>{title ?? "No title"}</span>
            <span className="whitespace-nowrap text-[12.5px] text-muted">{day(r.reviewed_on)}</span>
          </span>
          <span className="truncate text-[13px] text-muted">{snippet}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted">
            <span>{SHORT_NAMES[r.property]}</span>
            {r.urgent && <span className="font-semibold text-urgent">Urgent</span>}
            {r.sentiment === "negative" && !r.partner_reply && (title || disliked || liked) && <span className="font-medium text-warn">No reply yet</span>}
            {r.partner_reply && <span>Replied</span>}
            {translated && <span>Translated</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function Pane({ id }: { id: string | null }) {
  const q = useReview(id);
  return (
    <Panel aria-label="Selected review" className="px-5 py-5 sm:px-6">
      {!id ? <Empty>Select a review to read it here.</Empty>
        : q.isPending ? <Skeleton lines={9} />
        : q.isError ? <ErrorNote error={q.error} retry={q.refetch} />
        : <ReviewDetail review={q.data} />}
    </Panel>
  );
}
