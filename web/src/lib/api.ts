// Typed client for the FastAPI server (server/app/api.py). Paths are proxied by next.config.ts.

export type Sentiment = "positive" | "mixed" | "negative";
export type Polarity = "positive" | "negative";

export interface Period {
  from: string; to: string; previous_from: string; previous_to: string;
  label: string; previous_label: string;
}
export interface Window { from: string; to: string; reviews: number; avg_score: number | null; positive: number; mixed: number; negative: number }
export interface Comparison { current: Window; previous: Window; avg_change: number | null }
export interface Overview extends Comparison {
  period: Period;
  by_property: (Comparison & { property: string; name: string })[];
}

export interface Issue { topic: string; polarity: Polarity; issue: string; severity: 1 | 2 | 3 }
export interface Review {
  id: string; property: string; property_name: string; score: number; reviewed_at: number; reviewed_on: string;
  title: string | null; positive: string | null; negative: string | null; lang: string | null;
  title_en: string | null; positive_en: string | null; negative_en: string | null;
  checkin: string | null; checkout: string | null; nights: number | null; room_type: string | null;
  traveller_type: string | null; partner_reply: string | null;
  sentiment: Sentiment; urgent: boolean; urgent_reason: string | null; analysed: boolean;
  topics: { topic: string; polarity: Polarity }[]; issues: Issue[];
}
export interface ReviewPage { total: number; limit: number; offset: number; items: Review[] }

export interface TopicStat {
  topic: string; label: string; praised: number; complained: number; negative_reviews_mentioning: number;
  praise_rate: number | null; complaint_rate: number | null; share_of_negative_reviews: number | null;
  avg_score_when_complained: number | null; complaint_rate_change: number | null;
  previous: { praised: number; complained: number; share_of_negative_reviews: number | null };
}
export interface Topics {
  period: Period; reviews: number; avg_score: number | null; negative_reviews: number;
  previous: { reviews: number; negative_reviews: number };
  topics: TopicStat[]; insights: string[];
}

export interface ProblemGroup {
  id: number; label: string; topic: string; topic_label: string; reviews: number; share_of_reviews: number | null;
  previous_reviews: number; max_severity: number; avg_score: number | null; by_property: Record<string, number>;
  examples: { id: string; property: string; score: number; reviewed_on: string; text: string }[];
}
export interface Problems { period: Period; reviews_in_period: number; issues: ProblemGroup[] }

export interface TrendBucket { bucket: string; reviews: number; avg_score: number | null; positive: number; mixed: number; negative: number }
export interface Trends { interval: "day" | "week"; from: string; to: string; buckets: TrendBucket[] }

export interface Briefing {
  status: "fresh" | "stale" | "generating"; generating: boolean; generated_at?: number;
  briefing: {
    headline: string;
    what_changed: { text: string; review_ids: string[] }[];
    actions: { team: string; action: string; why: string; review_ids: string[] }[];
  } | null;
}

export interface Health {
  status: "ok" | "stale" | "failing"; reviews: number; with_text: number; analysed: number; llm_enabled: boolean;
  stale_after_hours: number;
  schedule: { every_hours: number | null; next_at: number | null; running: boolean };
  properties: {
    property: string; name: string; status: "ok" | "stale" | "failing"; stored_reviews: number;
    reported_reviews: number | null; last_collected_at: number | null; hours_since_collection: number | null;
    last_error: string | null; rejected_reviews: number;
  }[];
}

export interface ReviewCounts { all: number; urgent: number; no_reply: number; negative: number; translated: number; no_reply_oldest: string | null }

export interface Run {
  id: number; property: string; started_at: number; finished_at: number | null; status: string;
  pages: number; seen: number; new: number; rejected: number; reported_total: number | null; error: string | null;
}

export interface Coverage {
  reviews: number; with_text: number; non_english_with_text: number; non_english_pct: number | null;
  languages: { lang: string; reviews: number; with_text: number; analysed: number }[];
}

type Param = string | number | boolean | null | undefined | string[];

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, params: Record<string, Param> = {}): Promise<{ status: number; data: T }> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, String(v));
  }
  const res = await fetch(`/api/${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `The server answered ${res.status}`);
  }
  return { status: res.status, data: (await res.json()) as T };
}
