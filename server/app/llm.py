"""LLM layer (OpenAI). Nothing here runs on a user request; the API only reads what it stored.

1. analyse_review (gpt-5-nano): once per review after collection. Translates non-English text,
   extracts specific issues with topic, polarity and severity, flags urgent problems.
2. embed_phrases + group_phrases: embeds each distinct issue phrase once and adds it to the
   nearest group of the same polarity, so /api/issues is plain SQL for any date range.
3. generate_briefing (gpt-5-mini): the weekly briefing, written from numbers computed in SQL.
   Run by background jobs; cited review ids are checked against its input.

LLM_PROVIDER picks the route: "openai" (default, OPENAI_API_KEY) or "openrouter" (OPENROUTER_API_KEY,
the same OpenAI models through OpenRouter). Without the chosen key the API still works on keyword
tags and whatever was stored.

    python -m app.llm process     # enrich + group + refresh briefings (the collector runs this)
    python -m app.llm regroup     # rebuild issue groups, e.g. after changing ISSUE_GROUP_THRESHOLD
"""
import argparse
import asyncio
import json
import logging
import os
from typing import Literal

import numpy as np
from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel, Field

from . import db
from .topics import LABELS

load_dotenv(db.SERVER_DIR / ".env")
# Per-review analysis is high volume and simple: the cheapest model is good enough.
# Grouping and briefings are a few cached calls that need judgement: one step up.
MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-nano")
SUMMARY_MODEL = os.environ.get("OPENAI_SUMMARY_MODEL", "gpt-5-mini")
PROMPT_VERSION = 1
log = logging.getLogger("llm")

Topic = Literal["cleanliness", "check_in", "staff", "noise", "facilities", "location", "room_condition", "value", "other"]
assert set(Topic.__args__) == {*LABELS, "other"}


# OpenRouter serves the same OpenAI models behind an OpenAI-compatible API ("openai/<model>"),
# so it is a drop-in second route: same prompts, same embeddings, comparable results.
PROVIDER = os.environ.get("LLM_PROVIDER", "openai").strip().lower()
if PROVIDER not in ("openai", "openrouter"):
    raise ValueError(f"LLM_PROVIDER must be 'openai' or 'openrouter', not {PROVIDER!r}")
API_KEY = os.environ.get("OPENROUTER_API_KEY" if PROVIDER == "openrouter" else "OPENAI_API_KEY")


def enabled() -> bool:
    return bool(API_KEY)


def _client_args() -> dict:
    if PROVIDER == "openrouter":
        return {"api_key": API_KEY, "base_url": "https://openrouter.ai/api/v1"}
    return {"api_key": API_KEY}


def _model(name: str) -> str:
    """OpenRouter names OpenAI models "openai/<model>"; the bare name is what gets stored."""
    return f"openai/{name}" if PROVIDER == "openrouter" and "/" not in name else name


def _extra(model: str = MODEL) -> dict:
    # reasoning models: keep effort low, these are extraction and summary tasks
    return {"reasoning": {"effort": "low"}} if model.startswith(("gpt-5", "o")) else {}


# --- 1. per-review analysis --------------------------------------------------------

class Issue(BaseModel):
    topic: Topic
    polarity: Literal["positive", "negative"]
    issue: str = Field(description="specific, lowercase English phrase of at most 8 words")
    severity: Literal[1, 2, 3]


class ReviewAnalysis(BaseModel):
    title_en: str | None
    positive_en: str | None
    negative_en: str | None
    issues: list[Issue]
    urgent: bool
    urgent_reason: str | None


ANALYSE_PROMPT = """You analyse guest reviews for the operations team of four budget hotels and hostels in Sydney.
You get one Booking.com review as JSON: score (1-10), title, "liked" text, "disliked" text, language.

Return:
- title_en, positive_en, negative_en: English translations of title, liked and disliked text.
  null when the original is already English or empty.
- issues: every distinct thing the guest praised or complained about.
  - topic: cleanliness (dirt, smells, pests, hygiene) | check_in (arrival, keys, door codes, self check-in,
    check-out, luggage) | staff (people and service) | noise | facilities (shared spaces and amenities: lift,
    kitchen, wifi, aircon, laundry, shared bathrooms, toiletries) | location | room_condition (the room itself:
    bed, size, furniture, repairs, ventilation, private bathroom) | value (price, fees, refunds) | other.
  - polarity: from the meaning, not from the field it was written in. "Nothing" or "no complaints" in the
    disliked text is not an issue.
  - issue: a specific phrase an operations team can act on, phrased as the problem or praise itself, e.g.
    "shared bathroom not cleaned", "door code did not work", "friendly reception staff". Never just a topic name.
  - severity: 1 minor annoyance, 2 hurt the stay, 3 serious (health, safety, security, money, room unusable).
    Praise is always 1.
- urgent: true only for health, safety, security or legal risk: bed bugs or pests, injury, theft, harassment
  or assault, discrimination, fire, electrical or gas hazard, threats of legal action or chargeback.
  urgent_reason: a few words, else null."""


def _review_input(r) -> str:
    return json.dumps({"score": r["score"], "language": r["lang"], "title": r["title"],
                       "liked": r["positive"], "disliked": r["negative"]}, ensure_ascii=False)


async def analyse_review(client: AsyncOpenAI, r) -> dict:
    resp = await client.responses.parse(
        model=_model(MODEL), text_format=ReviewAnalysis, **_extra(),
        input=[{"role": "system", "content": ANALYSE_PROMPT}, {"role": "user", "content": _review_input(r)}])
    return resp.output_parsed.model_dump()


async def enrich_pending(limit: int | None = None, concurrency: int = 16) -> tuple[int, int]:
    """Analyse reviews that have text and no current analysis. Failures are logged and
    retried on the next run. Returns (analysed, failed)."""
    conn = db.connect()
    rows = conn.execute(
        "SELECT r.* FROM reviews r LEFT JOIN review_analysis a ON a.review_id = r.id "
        "WHERE (r.title IS NOT NULL OR r.positive IS NOT NULL OR r.negative IS NOT NULL) "
        "AND (a.review_id IS NULL OR a.prompt_version < ?) ORDER BY r.reviewed_at DESC"
        + (" LIMIT ?" if limit else ""), (PROMPT_VERSION, limit) if limit else (PROMPT_VERSION,)).fetchall()
    client = AsyncOpenAI(**_client_args())
    sem = asyncio.Semaphore(concurrency)
    done = failed = 0

    async def one(r):
        nonlocal done, failed
        async with sem:
            try:
                db.save_analysis(conn, r["id"], await analyse_review(client, r), MODEL, PROMPT_VERSION)
                done += 1
                if done % 50 == 0:
                    log.info("analysed %d/%d", done, len(rows))
            except Exception as e:
                failed += 1
                log.warning("review %s: %s: %s", r["id"], type(e).__name__, str(e)[:200])

    await asyncio.gather(*(one(r) for r in rows))
    log.info("enrich: %d analysed, %d failed", done, failed)
    return done, failed


# --- 2. issue groups (at ingest time, not per request) ---------------------------------------

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIMS = 512
GROUP_THRESHOLD = float(os.environ.get("ISSUE_GROUP_THRESHOLD", "0.75"))  # strict: merging is left to merge_groups


def embed_phrases(conn) -> int:
    """Register new issue phrases and embed the ones without a vector (batched, ~$0.02 per 1M tokens)."""
    with conn:
        conn.execute("INSERT OR IGNORE INTO issue_phrases (polarity, issue) "
                     "SELECT DISTINCT polarity, issue FROM review_issues")
    rows = conn.execute("SELECT polarity, issue FROM issue_phrases WHERE embedding IS NULL").fetchall()
    client = OpenAI(**_client_args())
    for i in range(0, len(rows), 1000):
        batch = rows[i:i + 1000]
        resp = client.embeddings.create(model=_model(EMBED_MODEL), dimensions=EMBED_DIMS, input=[r["issue"] for r in batch])
        with conn:
            conn.executemany("UPDATE issue_phrases SET embedding = ? WHERE polarity = ? AND issue = ?",
                             [(np.asarray(d.embedding, dtype=np.float32).tobytes(), r["polarity"], r["issue"])
                              for d, r in zip(resp.data, batch)])
    return len(rows)


def group_phrases(conn, threshold: float = GROUP_THRESHOLD) -> int:
    """Incremental leader clustering. Ungrouped phrases, most frequent first, join the group whose
    centroid is most similar (cosine >= threshold, same polarity), otherwise they start a new group
    labelled with that phrase. Existing assignments never move, so group ids and labels stay stable
    between runs. Returns the number of phrases assigned."""
    phrases = conn.execute("""
        SELECT p.polarity, p.issue, p.embedding, p.group_id,
               COUNT(i.review_id) AS n,
               (SELECT topic FROM review_issues t WHERE t.polarity = p.polarity AND t.issue = p.issue
                GROUP BY topic ORDER BY COUNT(*) DESC LIMIT 1) AS topic
        FROM issue_phrases p LEFT JOIN review_issues i ON i.polarity = p.polarity AND i.issue = p.issue
        WHERE p.embedding IS NOT NULL GROUP BY p.polarity, p.issue""").fetchall()
    vec = {(p["polarity"], p["issue"]): np.frombuffer(p["embedding"], dtype=np.float32) for p in phrases}

    # per polarity: running sums of member vectors and their normalised centroids
    state: dict[str, dict] = {}
    for pol in {p["polarity"] for p in phrases}:
        state[pol] = {"ids": [], "sums": np.zeros((len(phrases), EMBED_DIMS), np.float32)}
    for p in phrases:
        if p["group_id"] is not None:
            st = state[p["polarity"]]
            if p["group_id"] not in st["ids"]:
                st["ids"].append(p["group_id"])
            st["sums"][st["ids"].index(p["group_id"])] += vec[(p["polarity"], p["issue"])]

    assigned = []
    with conn:
        for p in sorted((p for p in phrases if p["group_id"] is None), key=lambda p: -p["n"]):
            st, v = state[p["polarity"]], vec[(p["polarity"], p["issue"])]
            k = len(st["ids"])
            if k:
                sums = st["sums"][:k]
                sims = (sums @ v) / np.linalg.norm(sums, axis=1)
                best = int(np.argmax(sims))
            if k and sims[best] >= threshold:
                gid = st["ids"][best]
                st["sums"][best] += v
            else:
                gid = conn.execute("INSERT INTO issue_groups (polarity, topic, label) VALUES (?, ?, ?)",
                                   (p["polarity"], p["topic"] or "other", p["issue"])).lastrowid
                st["ids"].append(gid)
                st["sums"][k] = v
            assigned.append((gid, p["polarity"], p["issue"]))
        conn.executemany("UPDATE issue_phrases SET group_id = ? WHERE polarity = ? AND issue = ?", assigned)
    return len(assigned)


class GroupDecision(BaseModel):
    id: int
    merge_into: int | None = Field(description="id of the group this is the same problem as, else null")
    label: str = Field(description="concrete problem name, max 6 words")


class GroupDecisions(BaseModel):
    decisions: list[GroupDecision]


MERGE_PROMPT = """You maintain the list of guest-review problems for the operations team of budget hotels.
Embedding similarity already grouped near-identical phrases; you fix what it can't see.
Input: "known" groups (id, label) and "new" groups (id, label, example phrases, mentions).

For each new group:
- merge_into: the id of a known or new group that is the SAME problem, i.e. one fix (one team, one
  action) solves both, e.g. "no reception" + "no staff at reception" + "no on-site staff". Otherwise null.
  Do not merge problems that need different fixes: "bathrooms dirty" (housekeeping) is not
  "not enough bathrooms" (capacity), and "noisy guests" is not "squeaky beds".
- label: a concrete name a manager can assign, max 6 words, e.g. "shared bathrooms not cleaned",
  "door codes not working". Never a category ("cleanliness issues") or a list."""


def merge_groups(conn, batch_size: int = 120) -> int:
    """LLM pass over groups not reviewed yet (with 2+ mentions; singletons keep their phrase as label):
    merges same-problem duplicates and names groups. Incremental: known groups are only context.
    Returns the number of merges."""
    def groups(reviewed: int, pol: str):
        return conn.execute("""
            SELECT g.id, g.label, COUNT(i.review_id) AS n,
                   (SELECT group_concat(issue, ' ; ') FROM (SELECT issue FROM issue_phrases
                    WHERE group_id = g.id LIMIT 5)) AS examples
            FROM issue_groups g JOIN issue_phrases p ON p.group_id = g.id
            JOIN review_issues i ON i.polarity = p.polarity AND i.issue = p.issue
            WHERE g.reviewed = ? AND g.polarity = ? GROUP BY g.id ORDER BY n DESC""", (reviewed, pol)).fetchall()

    merges = 0
    for pol in ("negative", "positive"):
        pending = [g for g in groups(0, pol) if g["n"] >= 2]
        for b in range(0, len(pending), batch_size):
            batch = pending[b:b + batch_size]
            known = [{"id": g["id"], "label": g["label"]} for g in groups(1, pol) if g["n"] >= 2]
            new = [{"id": g["id"], "label": g["label"], "examples": g["examples"], "mentions": g["n"]} for g in batch]
            out = _parse(MERGE_PROMPT, json.dumps({"known": known, "new": new}, ensure_ascii=False), GroupDecisions)
            ids = {g["id"] for g in batch} | {k["id"] for k in known}
            target = {d.id: d.merge_into for d in out.decisions
                      if d.id in ids and d.merge_into in ids and d.merge_into != d.id}
            with conn:
                for d in out.decisions:
                    if d.id in ids:
                        conn.execute("UPDATE issue_groups SET label = ? WHERE id = ?", (d.label.strip(), d.id))
                for src in target:
                    dst, seen = target[src], {src}
                    while dst in target and dst not in seen:  # follow chains, stop on cycles
                        seen.add(dst)
                        dst = target[dst]
                    if dst in seen:
                        continue
                    conn.execute("UPDATE issue_phrases SET group_id = ? WHERE group_id = ?", (dst, src))
                    conn.execute("DELETE FROM issue_groups WHERE id = ?", (src,))
                    merges += 1
                conn.execute(f"UPDATE issue_groups SET reviewed = 1 WHERE id IN ({','.join('?' * len(batch))})",
                             [g["id"] for g in batch])
            log.info("merge_groups %s: batch %d, %d merges so far", pol, b // batch_size + 1, merges)
    with conn:  # singletons: nothing to merge, keep their phrase as the label
        conn.execute("UPDATE issue_groups SET reviewed = 1 WHERE reviewed = 0")
    return merges


# --- 3. weekly briefing ------------------------------------------------------------------


class Point(BaseModel):
    text: str
    review_ids: list[str]


class Action(BaseModel):
    team: Literal["housekeeping", "maintenance", "front desk", "management"]
    action: str
    why: str
    review_ids: list[str]


class Briefing(BaseModel):
    headline: str = Field(description="one sentence, the single most important thing this week")
    what_changed: list[Point]
    actions: list[Action]


BRIEFING_PROMPT = """You write a Monday-morning briefing for the operations manager of budget hotels in Sydney.
Input JSON: the period (with its label, e.g. "this week"), review counts and average scores vs the previous
period, topic statistics,
the most common specific issues with example reviews (id, score, English text), and urgent reviews.

Rules:
- Use only numbers that appear in the input. Never calculate or invent new numbers.
- Write changes as a direction word plus the size, with no sign: avg_change -1.38 is "fell 1.38 points
  (from 6.26 to 4.88)", never "fell by -1.38" or "changed by -1.38".
- Only state what the input reviews say. Do not guess causes or details they do not mention.
- Cite supporting reviews in review_ids only; never write review ids in the text.
- Use different reviews as evidence for different points where the input allows.
- Name the property when a problem is concentrated in one.
- what_changed: 2 to 4 points, most important first; urgent reviews first if any.
- actions: 2 to 4 concrete actions a team can do this week, each tied to evidence.
- Plain, direct language. If there are too few reviews to conclude anything, say so."""


def _parse(system: str, user: str, schema: type[BaseModel]) -> BaseModel:
    resp = OpenAI(**_client_args()).responses.parse(model=_model(SUMMARY_MODEL), text_format=schema, **_extra(SUMMARY_MODEL),
                                    input=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return resp.output_parsed


def generate_briefing(facts: dict) -> dict:
    """Slow (tens of seconds): called from background jobs only, never on a request."""
    valid_ids = {r["id"] for c in facts.get("top_issues", []) for r in c.get("examples", [])} | \
                {r["id"] for r in facts.get("urgent", [])}
    b = _parse(BRIEFING_PROMPT, json.dumps(facts, ensure_ascii=False), Briefing).model_dump()
    for item in b["what_changed"] + b["actions"]:
        item["review_ids"] = [i for i in item["review_ids"] if i in valid_ids]  # drop invented citations
    return b


def process_new(conn=None) -> None:
    """Everything after a collection: analyse new reviews, group their issues, refresh briefings."""
    conn = conn or db.connect()
    asyncio.run(enrich_pending())
    log.info("embedded %d phrases", embed_phrases(conn))
    log.info("grouped %d phrases", group_phrases(conn))
    log.info("merged %d groups", merge_groups(conn))
    from .api import refresh_briefings  # api imports this module
    refresh_briefings()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["process", "enrich", "group", "regroup"],
                    help="process = enrich + group + briefings; regroup = rebuild all groups (new threshold)")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not enabled():
        raise SystemExit("OPENAI_API_KEY is not set (server/.env)")
    conn = db.connect()
    if args.command == "process":
        process_new(conn)
    elif args.command == "enrich":
        asyncio.run(enrich_pending(args.limit))
    else:
        if args.command == "regroup":
            with conn:
                conn.execute("UPDATE issue_phrases SET group_id = NULL")
                conn.execute("DELETE FROM issue_groups")
        log.info("embedded %d phrases", embed_phrases(conn))
        log.info("grouped %d phrases", group_phrases(conn))
        log.info("merged %d groups", merge_groups(conn))
