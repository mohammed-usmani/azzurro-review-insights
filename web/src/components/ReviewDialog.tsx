"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type Review } from "@/lib/api";
import { date, language, TRAVELLER } from "@/lib/format";
import { ErrorNote, ScoreChip, Skeleton } from "./ui";

const OpenReview = createContext<(id: string) => void>(() => {});
export const useOpenReview = () => useContext(OpenReview);

/** One reading panel for the whole page: any review id anywhere can open it. */
export function ReviewDialogProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCallback((reviewId: string) => setId(reviewId), []);

  useEffect(() => {
    if (id) ref.current?.showModal();
  }, [id]);

  return (
    <OpenReview.Provider value={open}>
      {children}
      <dialog
        ref={ref}
        onClose={() => setId(null)}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        aria-label="Review"
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-surface p-0 text-ink shadow-2xl sm:border-l sm:border-line"
      >
        {id && <ReviewBody id={id} close={() => ref.current?.close()} />}
      </dialog>
    </OpenReview.Provider>
  );
}

function ReviewBody({ id, close }: { id: string; close: () => void }) {
  const q = useQuery({ queryKey: ["review", id], queryFn: () => api<Review>(`reviews/${id}`).then((r) => r.data) });
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm text-muted">Guest review</p>
        <button onClick={close} className="rounded px-2 py-1 text-sm font-medium hover:bg-paper" autoFocus>
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {q.isPending ? <Skeleton lines={6} /> : q.isError ? <ErrorNote error={q.error} retry={q.refetch} /> : <ReviewDetail review={q.data} />}
      </div>
    </div>
  );
}

export function ReviewDetail({ review: r }: { review: Review }) {
  const translated = Boolean(r.positive_en || r.negative_en || r.title_en);
  const [original, setOriginal] = useState(false);
  const show = (orig: string | null, en: string | null) => (original || !translated ? orig : en ?? orig);
  const stay = [r.room_type, r.nights && `${r.nights} night${r.nights > 1 ? "s" : ""}`, r.traveller_type && TRAVELLER[r.traveller_type]]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="space-y-5">
      {r.urgent && (
        <p className="rounded-md bg-urgent-soft px-3 py-2 text-sm font-medium text-urgent">
          Flagged as urgent: {r.urgent_reason ?? "possible health, safety or legal risk"}
        </p>
      )}
      <header className="flex items-start gap-3">
        <ScoreChip value={r.score} />
        <div>
          <h3 className="text-lg font-semibold leading-snug">{show(r.title, r.title_en) ?? "No title"}</h3>
          <p className="text-sm text-muted">
            {r.property_name}, reviewed {date(r.reviewed_on)}
          </p>
          {stay && <p className="text-sm text-muted">{stay}</p>}
        </div>
      </header>

      {translated && (
        <p className="text-sm text-muted">
          Translated from {language(r.lang)}.{" "}
          <button onClick={() => setOriginal(!original)} className="font-medium text-accent underline underline-offset-2">
            {original ? "Show English" : "Show original"}
          </button>
        </p>
      )}

      <ReviewText label="Liked" tone="pos" text={show(r.positive, r.positive_en)} />
      <ReviewText label="Disliked" tone="neg" text={show(r.negative, r.negative_en)} />

      {r.issues.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">What this review mentions</h4>
          <ul className="flex flex-wrap gap-1.5">
            {r.issues.map((i) => (
              <li key={i.polarity + i.issue} className={`rounded-full px-2.5 py-0.5 text-sm ${i.polarity === "negative" ? "bg-neg/10 text-neg" : "bg-pos/10 text-pos"}`}>
                {i.issue}
                {i.severity === 3 && <span className="sr-only"> (serious)</span>}
                {i.severity === 3 && <span aria-hidden> !</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-1 text-sm font-semibold">Hotel reply</h4>
        {r.partner_reply ? (
          <p className="whitespace-pre-line text-sm text-muted">{r.partner_reply}</p>
        ) : (
          <p className="text-sm text-warn">No reply yet. Replies are posted from the Booking.com extranet.</p>
        )}
      </div>
    </article>
  );
}

function ReviewText({ label, tone, text }: { label: string; tone: "pos" | "neg"; text: string | null }) {
  if (!text) return null;
  return (
    <div className={`border-l-2 pl-3 ${tone === "pos" ? "border-pos" : "border-neg"}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-0.5 whitespace-pre-line leading-relaxed">{text}</p>
    </div>
  );
}
