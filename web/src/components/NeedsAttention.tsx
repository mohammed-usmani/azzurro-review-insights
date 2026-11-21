"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type ReviewPage } from "@/lib/api";
import { day, SHORT_NAMES } from "@/lib/format";
import { useOpenReview } from "./ReviewDialog";
import { ErrorNote, ScoreChip, Skeleton } from "./ui";

/** Follow-up list: urgent reviews first, then poor reviews the hotel hasn't answered. */
export function NeedsAttention({ params, onShowAll }: { params: Record<string, string | undefined>; onShowAll: (f: { urgent?: boolean; unanswered?: boolean }) => void }) {
  const urgent = useQuery({ queryKey: ["reviews", "urgent", params], queryFn: () => api<ReviewPage>("reviews", { ...params, urgent: true, limit: 5 }).then((r) => r.data) });
  const unanswered = useQuery({
    queryKey: ["reviews", "unanswered", params],
    queryFn: () => api<ReviewPage>("reviews", { ...params, sentiment: "negative", replied: false, has_text: true, sort: "oldest", limit: 5 }).then((r) => r.data),
  });
  const open = useOpenReview();

  if (urgent.isError || unanswered.isError) return <ErrorNote error={urgent.error ?? unanswered.error} retry={() => { urgent.refetch(); unanswered.refetch(); }} />;
  if (!urgent.data || !unanswered.data) return <Skeleton lines={5} />;

  const list = (page: ReviewPage, tone: "urgent" | "plain") => (
    <ul className="divide-y divide-line">
      {page.items.map((r) => (
        <li key={r.id}>
          <button onClick={() => open(r.id)} className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-paper">
            <ScoreChip value={r.score} />
            <span className="min-w-0">
              <span className={`block truncate text-sm ${tone === "urgent" ? "font-medium text-urgent" : ""}`}>
                {tone === "urgent" ? r.urgent_reason : (r.title_en ?? r.title ?? r.negative_en ?? r.negative ?? r.positive_en ?? r.positive ?? "No text")}
              </span>
              <span className="block text-xs text-muted">{SHORT_NAMES[r.property]}, {day(r.reviewed_on)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">
          {urgent.data.total ? `${urgent.data.total} urgent review${urgent.data.total > 1 ? "s" : ""}` : "No urgent reviews"}
        </h3>
        <p className="mb-1 text-sm text-muted">Health, safety, security or legal risks, flagged by AI.</p>
        {urgent.data.total > 0 && list(urgent.data, "urgent")}
        {urgent.data.total > 5 && <button onClick={() => onShowAll({ urgent: true })} className="mt-1 text-sm font-medium text-accent">See all {urgent.data.total}</button>}
      </div>
      <div>
        <h3 className="font-semibold">
          {unanswered.data.total ? `${unanswered.data.total} poor review${unanswered.data.total > 1 ? "s" : ""} without a reply` : "Every poor review has a reply"}
        </h3>
        <p className="mb-1 text-sm text-muted">Score 6 or below, oldest first.</p>
        {unanswered.data.total > 0 && list(unanswered.data, "plain")}
        {unanswered.data.total > 5 && <button onClick={() => onShowAll({ unanswered: true })} className="mt-1 text-sm font-medium text-accent">See all {unanswered.data.total}</button>}
      </div>
    </div>
  );
}
