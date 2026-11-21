"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Review, type ReviewPage } from "@/lib/api";
import { day, plural, SHORT_NAMES } from "@/lib/format";
import { useOpenReview } from "./ReviewDialog";
import { Empty, ErrorNote, ScoreChip, Skeleton } from "./ui";

export interface FeedFilters {
  topic?: string; sentiment?: string; q?: string; unanswered?: boolean; urgent?: boolean;
  problem?: { id: number; label: string }; sort?: string; scoreOnly?: boolean;
}

const TOPICS = [
  ["cleanliness", "Cleanliness"], ["check_in", "Check-in"], ["staff", "Staff"], ["noise", "Noise"],
  ["facilities", "Facilities"], ["location", "Location"], ["room_condition", "Room condition"], ["value", "Value for money"],
];
const PAGE = 15;

export function ReviewFeed({ params, filters, setFilters }: {
  params: Record<string, string | undefined>; filters: FeedFilters; setFilters: (f: FeedFilters) => void;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => setPage(0), [params, filters]);
  useEffect(() => {
    const t = setTimeout(() => search !== (filters.q ?? "") && setFilters({ ...filters, q: search || undefined }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = {
    ...params,
    topic: filters.topic, polarity: filters.topic ? "negative" : undefined,
    sentiment: filters.unanswered ? "negative" : filters.sentiment,
    replied: filters.unanswered ? false : undefined,
    urgent: filters.urgent || undefined,
    issue_group: filters.problem?.id,
    has_text: filters.scoreOnly ? undefined : true,
    q: filters.q, sort: filters.sort ?? "newest", limit: PAGE, offset: page * PAGE,
  };
  const q = useQuery({
    queryKey: ["reviews", "feed", query],
    queryFn: () => api<ReviewPage>("reviews", query).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const control = "h-9 rounded-md border border-line bg-surface px-2.5 text-sm";
  const active = [
    filters.problem && { label: `Problem: ${filters.problem.label}`, clear: { problem: undefined } },
    filters.urgent && { label: "Urgent only", clear: { urgent: undefined } },
    filters.unanswered && { label: "Poor reviews without a reply", clear: { unanswered: undefined } },
  ].filter(Boolean) as { label: string; clear: Partial<FeedFilters> }[];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder="Search review text" aria-label="Search reviews" value={search}
          onChange={(e) => setSearch(e.target.value)} className={`${control} w-full sm:w-64`} />
        <select aria-label="Complaints about" className={control} value={filters.topic ?? ""}
          onChange={(e) => setFilters({ ...filters, topic: e.target.value || undefined })}>
          <option value="">Any topic</option>
          {TOPICS.map(([v, l]) => <option key={v} value={v}>Complaints about {l.toLowerCase()}</option>)}
        </select>
        <select aria-label="Rating" className={control} value={filters.sentiment ?? ""} disabled={filters.unanswered}
          onChange={(e) => setFilters({ ...filters, sentiment: e.target.value || undefined })}>
          <option value="">Any rating</option>
          <option value="positive">Positive (8–10)</option>
          <option value="mixed">Mixed (6–8)</option>
          <option value="negative">Negative (6 or below)</option>
        </select>
        <select aria-label="Sort" className={control} value={filters.sort ?? "newest"} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="lowest">Lowest score first</option>
          <option value="highest">Highest score first</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={Boolean(filters.scoreOnly)} onChange={(e) => setFilters({ ...filters, scoreOnly: e.target.checked || undefined })} />
          Include score-only reviews
        </label>
      </div>

      {active.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {active.map((a) => (
            <li key={a.label}>
              <button onClick={() => setFilters({ ...filters, ...a.clear })} className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
                {a.label} <span aria-hidden>×</span><span className="sr-only">(remove filter)</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {q.isPending ? <Skeleton lines={6} /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : q.data.total === 0 ? (
          <Empty>No reviews match these filters. Try a longer period or remove a filter.</Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted" aria-live="polite">{plural(q.data.total, "review")}</p>
            <ul className={`divide-y divide-line border-y border-line ${q.isPlaceholderData ? "opacity-60" : ""}`}>
              {q.data.items.map((r) => <FeedItem key={r.id} review={r} />)}
            </ul>
            <div className="mt-3 flex items-center justify-between text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="font-medium text-accent disabled:text-faint">Newer</button>
              <span className="text-muted">Page {page + 1} of {Math.ceil(q.data.total / PAGE)}</span>
              <button disabled={(page + 1) * PAGE >= q.data.total} onClick={() => setPage(page + 1)} className="font-medium text-accent disabled:text-faint">Older</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FeedItem({ review: r }: { review: Review }) {
  const open = useOpenReview();
  const liked = r.positive_en ?? r.positive;
  const disliked = r.negative_en ?? r.negative;
  return (
    <li>
      <button onClick={() => open(r.id)} className="flex w-full gap-3 py-4 text-left hover:bg-surface">
        <ScoreChip value={r.score} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{r.title_en ?? r.title ?? "No title"}</span>
            <span className="text-xs text-muted">{SHORT_NAMES[r.property]}, {day(r.reviewed_on)}</span>
          </span>
          {liked && <span className="mt-1 line-clamp-2 block text-sm"><span className="font-medium text-pos">Liked: </span>{liked}</span>}
          {disliked && <span className="mt-0.5 line-clamp-2 block text-sm"><span className="font-medium text-neg">Disliked: </span>{disliked}</span>}
          {!liked && !disliked && <span className="mt-1 block text-sm text-muted">Score only, no written review.</span>}
          <span className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
            {r.urgent && <span className="font-medium text-urgent">Urgent: {r.urgent_reason}</span>}
            {(r.positive_en || r.negative_en) && <span>Translated</span>}
            {r.partner_reply ? <span>Hotel replied</span> : r.sentiment === "negative" && <span className="text-warn">No reply yet</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
