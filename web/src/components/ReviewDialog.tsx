"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type Review } from "@/lib/api";
import { date, language, TOPIC_LABEL, TRAVELLER } from "@/lib/format";
import { ErrorNote, ScoreChip, Skeleton } from "./ui";

const OpenReview = createContext<(id: string) => void>(() => {});
export const useOpenReview = () => useContext(OpenReview);

/** One side panel for the whole app: any review id anywhere (briefing citations, lists) can open it. */
export function ReviewDialogProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCallback((reviewId: string) => setId(reviewId), []);

  useEffect(() => {
    if (id && !ref.current?.open) ref.current?.showModal();
  }, [id]);

  return (
    <OpenReview.Provider value={open}>
      {children}
      <dialog
        ref={ref}
        onClose={() => setId(null)}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        aria-label="Guest review"
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-surface p-0 text-ink shadow-2xl sm:border-l sm:border-line"
      >
        {id && <ReviewById id={id} close={() => ref.current?.close()} />}
      </dialog>
    </OpenReview.Provider>
  );
}

export function useReview(id: string | null) {
  return useQuery({ queryKey: ["review", id], queryFn: () => api<Review>(`reviews/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

function ReviewById({ id, close }: { id: string; close: () => void }) {
  const q = useReview(id);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm text-muted">Guest review</p>
        <button onClick={close} className="rounded-md px-2 py-1 text-sm font-semibold hover:bg-paper" autoFocus>Close</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {q.isPending ? <Skeleton lines={8} /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : <ReviewDetail review={q.data} />}
      </div>
    </div>
  );
}

const DOT = (polarity: string, severity: number) =>
  polarity === "positive" ? "bg-pos" : severity >= 3 ? "bg-urgent" : severity === 2 ? "bg-neg" : "bg-mix";

/** Everything about one review: urgent reason, stay, translation, what it mentions and the hotel's reply. */
export function ReviewDetail({ review: r }: { review: Review }) {
  const translated = Boolean(r.positive_en || r.negative_en || r.title_en);
  const [original, setOriginal] = useState(false);
  useEffect(() => setOriginal(false), [r.id]);
  const show = (orig: string | null, en: string | null) => (original || !translated ? orig : en ?? orig);
  const title = show(r.title, r.title_en);
  const liked = show(r.positive, r.positive_en);
  const disliked = show(r.negative, r.negative_en);
  const stay = [
    r.checkin && r.checkout && { k: "Stay", v: `${date(r.checkin)} to ${date(r.checkout)}${r.nights ? `, ${r.nights} night${r.nights > 1 ? "s" : ""}` : ""}` },
    r.room_type && { k: "Room", v: r.room_type },
    r.traveller_type && { k: "Guest", v: TRAVELLER[r.traveller_type] ?? r.traveller_type.toLowerCase().replaceAll("_", " ") },
  ].filter(Boolean) as { k: string; v: string }[];
  const problems = r.issues.filter((i) => i.polarity === "negative");
  const praise = r.issues.filter((i) => i.polarity === "positive");

  return (
    <article className="flex flex-col gap-[18px]" aria-labelledby={`review-${r.id}`}>
      {r.urgent && (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-urgent-soft px-3.5 py-3 text-sm text-urgent-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="mt-px flex-none"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>
          <p><strong className="font-semibold">Urgent: {r.urgent_reason ?? "possible health, safety or legal risk"}.</strong> Flagged by AI because it describes a health, safety, security or legal risk. Check it today.</p>
        </div>
      )}
      <header className="flex items-start gap-3.5">
        <ScoreChip value={r.score} large />
        <div className="min-w-0">
          <h2 id={`review-${r.id}`} className={`text-[19px] font-bold leading-snug tracking-tight ${title ? "" : "text-muted"}`}>{title ?? "No title"}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{r.property_name}, posted {date(r.reviewed_on)}</p>
        </div>
      </header>
      {stay.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-[10px] bg-paper px-3.5 py-3 text-[13px]">
          {stay.map((s) => (
            <div key={s.k} className="flex gap-1.5"><dt className="text-muted">{s.k}</dt><dd>{s.v}</dd></div>
          ))}
        </dl>
      )}
      {translated && (
        <p className="flex flex-wrap items-center gap-x-2.5 text-[13px] text-muted">
          {original ? `Original (${language(r.lang)})` : `Translated from ${language(r.lang)}`}
          <button onClick={() => setOriginal(!original)} className="font-semibold text-accent">
            {original ? "Show English" : "Show original"}
          </button>
        </p>
      )}
      {liked && <Text label="Liked" className="text-pos-ink">{liked}</Text>}
      {disliked && <Text label="Disliked" className="text-neg-ink">{disliked}</Text>}
      {!liked && !disliked && <p className="text-sm text-muted">The guest left a score only, with no written review.</p>}

      {(problems.length > 0 || praise.length > 0) && (
        <div className="space-y-3">
          {problems.length > 0 && <Issues label="Problems found by AI" items={problems} />}
          {praise.length > 0 && <Issues label="Praised" items={praise} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
        <div className="min-w-0 flex-[1_1_240px]">
          <p className="mb-1.5 text-xs font-semibold text-muted">Hotel reply</p>
          {r.partner_reply
            ? <p className="whitespace-pre-line text-sm">{r.partner_reply}</p>
            : <p className="text-sm text-warn">{r.sentiment === "negative" ? "No reply yet." : "No reply. Not needed for a positive review, but it helps."}</p>}
        </div>
        {!r.partner_reply && (
          <a href="https://admin.booking.com/" target="_blank" rel="noreferrer"
            className="rounded-lg bg-ink px-3.5 py-2.5 text-sm font-semibold text-surface hover:opacity-90">
            Reply on Booking.com<span className="sr-only"> (opens the Booking.com extranet in a new tab)</span>
          </a>
        )}
      </div>
    </article>
  );
}

function Text({ label, className, children }: { label: string; className: string; children: string }) {
  return (
    <div>
      <p className={`mb-1.5 text-xs font-semibold ${className}`}>{label}</p>
      <p className="max-w-[68ch] whitespace-pre-line text-[15px] leading-relaxed">{children}</p>
    </div>
  );
}

function Issues({ label, items }: { label: string; items: Review["issues"] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li key={i.polarity + i.issue} className="inline-flex items-center gap-1.5 rounded-md bg-paper px-2 py-1 text-xs">
            <span className={`size-[7px] rounded-full ${DOT(i.polarity, i.severity)}`} aria-hidden />
            {i.issue}
            {i.polarity === "negative" && i.severity >= 3 && <span className="font-semibold text-urgent-ink">serious</span>}
            <span className="text-muted">{TOPIC_LABEL[i.topic] ?? "Other"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
