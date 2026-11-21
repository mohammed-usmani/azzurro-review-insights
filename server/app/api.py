"""Read API for the dashboard.

    uvicorn app.api:app --reload     # http://localhost:8000/docs

Dates are Sydney-local YYYY-MM-DD and ranges are inclusive. The default period is this calendar
week (Monday to today), compared with all of last week; see _period for other ranges.
Sentiment buckets use the Booking.com score: positive >= 8, negative <= 6, mixed in between.
"""
import hashlib
import json
import logging
import subprocess
import sys
import threading
import time
from contextlib import closing
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from . import db, llm
from .topics import LABELS, TOPICS

POSITIVE_MIN, NEGATIVE_MAX = 8, 6
SENTIMENT_SQL = {
    "positive": f"r.score >= {POSITIVE_MIN}",
    "negative": f"r.score <= {NEGATIVE_MAX}",
    "mixed": f"r.score > {NEGATIVE_MAX} AND r.score < {POSITIVE_MIN}",
}
ORDER_SQL = {
    "newest": "r.reviewed_at DESC",
    "oldest": "r.reviewed_at ASC",
    "highest": "r.score DESC, r.reviewed_at DESC",
    "lowest": "r.score ASC, r.reviewed_at DESC",
}

app = FastAPI(title="Azzurro review insights")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])

# Shared query params: ?property=a&property=b, ?from=YYYY-MM-DD&to=YYYY-MM-DD
Props = Query(default=[], alias="property", description="property slug, repeatable; empty = all")
From = Query(default=None, alias="from")
To = Query(default=None, alias="to")


def _conn():
    return closing(db.connect())


def _today() -> date:
    return datetime.now(db.TZ).date()


def _where(props: list[str], start: date | None = None, end: date | None = None) -> tuple[str, list]:
    unknown = set(props) - db.PROPERTIES.keys()
    if unknown:
        raise HTTPException(400, f"unknown property: {', '.join(sorted(unknown))}")
    if start and end and start > end:
        raise HTTPException(400, "'from' is after 'to'")
    sql, args = ["1=1"], []
    if props:
        sql.append(f"r.property IN ({','.join('?' * len(props))})")
        args += props
    if start:
        sql.append("r.reviewed_on >= ?")
        args.append(start.isoformat())
    if end:
        sql.append("r.reviewed_on <= ?")
        args.append(end.isoformat())
    return " AND ".join(sql), args


def _period(start: date | None, end: date | None) -> dict:
    """The selected range and the one it is compared with.
    Default: this calendar week, Monday to today, compared with all of last week (Mon-Sun).
    A range inside one calendar week starting on Monday is compared with the whole previous week;
    any other range with the same number of days just before it."""
    today = _today()
    end = end or today
    start = start or end - timedelta(days=end.weekday())
    if start > end:
        raise HTTPException(400, "'from' is after 'to'")
    days = (end - start).days + 1
    if start.weekday() == 0 and days <= 7:
        prev_start, prev_end = start - timedelta(days=7), start - timedelta(days=1)
        if start == today - timedelta(days=today.weekday()):
            label, prev_label = "this week", "last week"
        else:
            label, prev_label = "that week", "the week before"
    else:
        prev_start, prev_end = start - timedelta(days=days), start - timedelta(days=1)
        label, prev_label = "in this period", "the previous period"
    return {"from": start, "to": end, "previous_from": prev_start, "previous_to": prev_end,
            "label": label, "previous_label": prev_label}


def _period_json(p: dict) -> dict:
    return {k: v.isoformat() if isinstance(v, date) else v for k, v in p.items()}


def _sentiment(score: float) -> str:
    return "positive" if score >= POSITIVE_MIN else "negative" if score <= NEGATIVE_MAX else "mixed"


def _pct(part: int, whole: int) -> float | None:
    return round(100 * part / whole, 1) if whole else None


def _diff(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(a - b, 2)


def _window(conn, props, start: date, end: date) -> dict:
    w, a = _where(props, start, end)
    row = conn.execute(f"""
        SELECT COUNT(*) AS reviews, ROUND(AVG(r.score), 1) AS avg_score,
               COALESCE(SUM({SENTIMENT_SQL['positive']}), 0) AS positive,
               COALESCE(SUM({SENTIMENT_SQL['mixed']}), 0) AS mixed,
               COALESCE(SUM({SENTIMENT_SQL['negative']}), 0) AS negative
        FROM reviews r WHERE {w}""", a).fetchone()
    return {"from": start.isoformat(), "to": end.isoformat(), **dict(row)}


STALE_AFTER_HOURS = 48


@app.get("/api/health")
def health():
    """Data health for the dashboard footer and for monitoring: per property, when it was last
    collected, whether the last run failed, and how many of Booking.com's reviews are stored."""
    now = int(time.time())
    with _conn() as conn:
        stored = dict(conn.execute("SELECT property, COUNT(*) FROM reviews GROUP BY property").fetchall())
        last_ok = {r["property"]: dict(r) for r in conn.execute("""
            SELECT property, MAX(finished_at) AS at, reported_total FROM runs WHERE status = 'ok'
            GROUP BY property""")}
        last = {r["property"]: dict(r) for r in conn.execute("""
            SELECT property, status, error, MAX(started_at) AS at FROM runs GROUP BY property""")}
        rejected = dict(conn.execute("SELECT property, COUNT(*) FROM rejected_reviews GROUP BY property").fetchall())
        analysed = conn.execute("SELECT COUNT(*) FROM review_analysis").fetchone()[0]
        with_text = conn.execute("SELECT COUNT(*) FROM reviews WHERE title IS NOT NULL OR positive IS NOT NULL "
                                 "OR negative IS NOT NULL").fetchone()[0]
    properties, worst = [], "ok"
    for slug, name in db.PROPERTIES.items():
        ok, run = last_ok.get(slug) or {}, last.get(slug) or {}
        hours = round((now - ok["at"]) / 3600, 1) if ok.get("at") else None
        status = ("failing" if run.get("status") == "failed" else
                  "stale" if hours is None or hours > STALE_AFTER_HOURS else "ok")
        if status != "ok":
            worst = "failing" if "failing" in (status, worst) else "stale"
        properties.append({
            "property": slug, "name": name, "status": status,
            "stored_reviews": stored.get(slug, 0), "reported_reviews": ok.get("reported_total"),
            "last_collected_at": ok.get("at"), "hours_since_collection": hours,
            "last_error": run.get("error") if run.get("status") == "failed" else None,
            "rejected_reviews": rejected.get(slug, 0),
        })
    return {"status": worst, "reviews": sum(stored.values()), "with_text": with_text, "analysed": analysed,
            "llm_enabled": llm.enabled(), "stale_after_hours": STALE_AFTER_HOURS, "properties": properties}


@app.get("/api/properties")
def properties():
    """The four properties with all-time totals and the last successful collection."""
    with _conn() as conn:
        totals = {r["property"]: dict(r) for r in conn.execute("""
            SELECT property, COUNT(*) AS reviews, ROUND(AVG(score), 1) AS avg_score,
                   MAX(reviewed_on) AS latest_review
            FROM reviews GROUP BY property""")}
        collected = {r["property"]: r["at"] for r in conn.execute(
            "SELECT property, MAX(finished_at) AS at FROM runs WHERE status = 'ok' GROUP BY property")}
    return [{
        "slug": slug, "name": name, "url": db.property_url(slug),
        "reviews": totals.get(slug, {}).get("reviews", 0),
        "avg_score": totals.get(slug, {}).get("avg_score"),
        "latest_review": totals.get(slug, {}).get("latest_review"),
        "last_collected_at": collected.get(slug),
    } for slug, name in db.PROPERTIES.items()]


@app.get("/api/overview")
def overview(props: list[str] = Props, start: date | None = From, end: date | None = To):
    """Average rating for the selected period (default: this calendar week) vs the previous one,
    overall and per property. Counts are included because one review can move a weekly average a lot."""
    per = _period(start, end)
    _where(props)
    with _conn() as conn:
        def compare(p):
            now = _window(conn, p, per["from"], per["to"])
            prev = _window(conn, p, per["previous_from"], per["previous_to"])
            return {"current": now, "previous": prev, "avg_change": _diff(now["avg_score"], prev["avg_score"])}

        total = compare(props)
        by_property = [{"property": slug, "name": db.PROPERTIES[slug], **compare([slug])}
                       for slug in (props or db.PROPERTIES)]
    return {"period": _period_json(per), **total, "by_property": by_property}


def _fetch_reviews(w: str, a: list, sort: str, limit: int, offset: int) -> tuple[int, list[dict]]:
    with _conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM reviews r WHERE {w}", a).fetchone()[0]
        rows = [dict(r) for r in conn.execute(f"""
            SELECT {', '.join('r.' + c for c in db.COLS)}, x.title_en, x.positive_en, x.negative_en,
                   COALESCE(x.urgent, 0) AS urgent, x.urgent_reason, x.review_id IS NOT NULL AS analysed
            FROM reviews r LEFT JOIN review_analysis x ON x.review_id = r.id WHERE {w}
            ORDER BY {ORDER_SQL[sort]} LIMIT ? OFFSET ?""", [*a, limit, offset])]
        ids = [r["id"] for r in rows]
        marks = ','.join('?' * len(ids))
        tags: dict[str, list] = {i: [] for i in ids}
        found: dict[str, list] = {i: [] for i in ids}
        if ids:
            for t in conn.execute(f"SELECT review_id, topic, polarity FROM review_topics "
                                  f"WHERE review_id IN ({marks}) ORDER BY topic", ids):
                tags[t["review_id"]].append({"topic": t["topic"], "polarity": t["polarity"]})
            for i in conn.execute(f"SELECT review_id, topic, polarity, issue, severity FROM review_issues "
                                  f"WHERE review_id IN ({marks}) ORDER BY polarity, severity DESC", ids):
                found[i["review_id"]].append({k: i[k] for k in ("topic", "polarity", "issue", "severity")})
    items = [{**r, "urgent": bool(r["urgent"]), "analysed": bool(r["analysed"]),
              "property_name": db.PROPERTIES[r["property"]], "sentiment": _sentiment(r["score"]),
              "topics": tags[r["id"]], "issues": found[r["id"]]} for r in rows]
    return total, items


@app.get("/api/reviews")
def reviews(
    props: list[str] = Props,
    start: date | None = From,
    end: date | None = To,
    topic: str | None = Query(None, description=f"one of: {', '.join(TOPICS)}"),
    polarity: Literal["positive", "negative"] | None = Query(None, description="with topic: praised or complained about"),
    sentiment: Literal["positive", "mixed", "negative"] | None = None,
    q: str | None = Query(None, description="text search in title, review text and translations"),
    lang: str | None = Query(None, description="language code, e.g. en, fr, zh"),
    urgent: bool | None = Query(None, description="only reviews the LLM flagged as urgent"),
    issue_group: int | None = Query(None, description="id from /api/issues: reviews mentioning that problem"),
    replied: bool | None = Query(None, description="false = the hotel has not replied yet"),
    has_text: bool | None = Query(None, description="true = only reviews with a written title or text"),
    sort: Literal["newest", "oldest", "highest", "lowest"] = "newest",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Review feed with filters and paging."""
    w, a = _where(props, start, end)
    if topic:
        if topic not in TOPICS:
            raise HTTPException(400, f"unknown topic: {topic}")
        w += " AND EXISTS (SELECT 1 FROM review_topics t WHERE t.review_id = r.id AND t.topic = ?"
        a.append(topic)
        if polarity:
            w += " AND t.polarity = ?"
            a.append(polarity)
        w += ")"
    elif polarity:
        raise HTTPException(400, "'polarity' needs 'topic'")
    if sentiment:
        w += f" AND {SENTIMENT_SQL[sentiment]}"
    if q:
        w += (" AND (r.title LIKE ? OR r.positive LIKE ? OR r.negative LIKE ? OR EXISTS (SELECT 1 FROM review_analysis x"
              " WHERE x.review_id = r.id AND (x.title_en LIKE ? OR x.positive_en LIKE ? OR x.negative_en LIKE ?)))")
        a += [f"%{q}%"] * 6
    if lang:
        w += " AND r.lang = ?"
        a.append(lang)
    if issue_group is not None:
        w += (" AND EXISTS (SELECT 1 FROM review_issues i JOIN issue_phrases p"
              " ON p.polarity = i.polarity AND p.issue = i.issue"
              " WHERE i.review_id = r.id AND COALESCE(p.group_id, -p.rowid) = ?)")
        a.append(issue_group)
    if has_text is not None:
        w += f" AND {'' if has_text else 'NOT '}(r.title IS NOT NULL OR r.positive IS NOT NULL OR r.negative IS NOT NULL)"
    if replied is not None:
        w += f" AND r.partner_reply IS {'NOT ' if replied else ''}NULL"
    if urgent is not None:
        w += f" AND {'' if urgent else 'NOT '}EXISTS (SELECT 1 FROM review_analysis x WHERE x.review_id = r.id AND x.urgent = 1)"

    total, items = _fetch_reviews(w, a, sort, limit, offset)
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@app.get("/api/reviews/{review_id}")
def review(review_id: str):
    """One review with translation, issues and topics (for links from the briefing)."""
    with _conn() as conn:
        prop = conn.execute("SELECT property FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if not prop:
        raise HTTPException(404, "review not found")
    return _fetch_reviews("r.id = ?", [review_id], "newest", 1, 0)[1][0]


@app.get("/api/trends")
def trends(props: list[str] = Props, start: date | None = From, end: date | None = To,
           interval: Literal["day", "week"] = "week"):
    """Average score and positive/mixed/negative counts per day or per week (weeks start Monday).
    Default range: the last 12 weeks. Empty buckets are included with avg_score null."""
    end = end or _today()
    start = start or end - timedelta(weeks=12)
    step = timedelta(days=1 if interval == "day" else 7)
    if interval == "week":
        start -= timedelta(days=start.weekday())
    if (end - start) / step > 400:
        raise HTTPException(400, "range too long for this interval")
    bucket = "r.reviewed_on" if interval == "day" else "date(r.reviewed_on, 'weekday 0', '-6 days')"
    w, a = _where(props, start, end)
    with _conn() as conn:
        found = {r["bucket"]: dict(r) for r in conn.execute(f"""
            SELECT {bucket} AS bucket, COUNT(*) AS reviews, ROUND(AVG(r.score), 1) AS avg_score,
                   SUM({SENTIMENT_SQL['positive']}) AS positive, SUM({SENTIMENT_SQL['mixed']}) AS mixed,
                   SUM({SENTIMENT_SQL['negative']}) AS negative
            FROM reviews r WHERE {w} GROUP BY bucket""", a)}
    buckets, day = [], start
    while day <= end:
        key = day.isoformat()
        buckets.append(found.get(key) or {"bucket": key, "reviews": 0, "avg_score": None,
                                          "positive": 0, "mixed": 0, "negative": 0})
        day += step
    return {"interval": interval, "from": start.isoformat(), "to": end.isoformat(), "buckets": buckets}


def _topic_stats(conn, props, start: date, end: date) -> tuple[dict, dict]:
    w, a = _where(props, start, end)
    totals = dict(conn.execute(f"""SELECT COUNT(*) AS reviews, ROUND(AVG(r.score), 1) AS avg_score,
                                   COALESCE(SUM({SENTIMENT_SQL['negative']}), 0) AS negative_reviews
                                   FROM reviews r WHERE {w}""", a).fetchone())
    stats = {k: {"praised": 0, "complained": 0, "negative_reviews_mentioning": 0,
                 "avg_score_when_complained": None} for k in TOPICS}
    for r in conn.execute(f"""
            SELECT t.topic, t.polarity, COUNT(*) AS n, COALESCE(SUM({SENTIMENT_SQL['negative']}), 0) AS in_negative,
                   ROUND(AVG(r.score), 1) AS avg_score
            FROM review_topics t JOIN reviews r ON r.id = t.review_id
            WHERE {w} GROUP BY t.topic, t.polarity""", a):
        if r["polarity"] == "positive":
            stats[r["topic"]]["praised"] = r["n"]
        else:
            stats[r["topic"]]["complained"] = r["n"]
            stats[r["topic"]]["negative_reviews_mentioning"] = r["in_negative"]
            stats[r["topic"]]["avg_score_when_complained"] = r["avg_score"]  # vs the period average: what drags the score
    for s in stats.values():
        s["praise_rate"] = _pct(s["praised"], totals["reviews"])
        s["complaint_rate"] = _pct(s["complained"], totals["reviews"])
        s["share_of_negative_reviews"] = _pct(s["negative_reviews_mentioning"], totals["negative_reviews"])
    return totals, stats


def _insights(totals, cur, prev, period: str, prev_period: str) -> list[str]:
    out = []
    complaints = sorted((k for k in cur if cur[k]["complained"]), key=lambda k: -cur[k]["complained"])[:3]
    for k in complaints:
        label, s, p = LABELS[k].lower(), cur[k], prev[k]
        if s["negative_reviews_mentioning"]:
            line = f"{s['share_of_negative_reviews']:g}% of negative reviews {period} mentioned {label}"
            before = p["share_of_negative_reviews"]
        else:
            n = s["complained"]
            line = f"{n} review{'s' if n != 1 else ''} {period} complained about {label}"
            before = None
        if before is not None:
            now = s["share_of_negative_reviews"]
            line += (f" (same as {prev_period})" if now == before else
                     f" ({'up' if now > before else 'down'} from {before:g}% {prev_period})")
        out.append(line)
    praised = max(cur, key=lambda k: cur[k]["praised"])
    if cur[praised]["praised"]:
        out.append(f"{LABELS[praised]} was praised in {cur[praised]['praise_rate']:g}% of reviews {period}")
    if not totals["reviews"]:
        out.append(f"No reviews {period}")
    return out


@app.get("/api/topics")
def topics(props: list[str] = Props, start: date | None = From, end: date | None = To):
    """Per-topic praise/complaint counts for the period and the one before it, plus plain-language
    insights. Default period: this calendar week (see _period)."""
    per = _period(start, end)
    _where(props)
    with _conn() as conn:
        totals, cur = _topic_stats(conn, props, per["from"], per["to"])
        prev_totals, prev = _topic_stats(conn, props, per["previous_from"], per["previous_to"])
    period, prev_period = per["label"], per["previous_label"]
    return {
        "period": _period_json(per),
        "from": per["from"].isoformat(), "to": per["to"].isoformat(),
        "previous": {"from": per["previous_from"].isoformat(), "to": per["previous_to"].isoformat(), **prev_totals},
        **totals,
        "topics": [{"topic": k, "label": LABELS[k], **cur[k],
                    "previous": prev[k],
                    "complaint_rate_change": _diff(cur[k]["complaint_rate"], prev[k]["complaint_rate"])}
                   for k in TOPICS],
        "insights": _insights(totals, cur, prev, period, prev_period),
    }


@app.get("/api/runs")
def runs(limit: int = Query(20, ge=1, le=200)):
    """Collection log, newest first."""
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,))]


_collector: subprocess.Popen | None = None  # ponytail: one collector per API process; a job queue if this ever runs multi-worker


@app.post("/api/collect", status_code=202)
def collect(props: list[str] = Props, full: bool = False):
    """Start the collector in the background (opens a browser window on this machine). Poll /api/runs."""
    global _collector
    _where(props)
    if _collector and _collector.poll() is None:
        raise HTTPException(409, "a collection is already running")
    args = [sys.executable, "-m", "app.collector", *[x for p in props for x in ("--property", p)]]
    _collector = subprocess.Popen(args + (["--full"] if full else []), cwd=db.SERVER_DIR)
    return {"started": True, "pid": _collector.pid}


@app.get("/api/coverage")
def coverage():
    """How much of the data can be read and analysed: languages, text, LLM analysis."""
    with _conn() as conn:
        langs = [dict(r) for r in conn.execute("""
            SELECT COALESCE(r.lang, 'unknown') AS lang, COUNT(*) AS reviews,
                   SUM(r.title IS NOT NULL OR r.positive IS NOT NULL OR r.negative IS NOT NULL) AS with_text,
                   COUNT(x.review_id) AS analysed
            FROM reviews r LEFT JOIN review_analysis x ON x.review_id = r.id
            GROUP BY 1 ORDER BY reviews DESC""")]
    with_text = sum(l["with_text"] for l in langs)
    english = sum(l["with_text"] for l in langs if l["lang"] == "en")
    return {"reviews": sum(l["reviews"] for l in langs), "with_text": with_text,
            "non_english_with_text": with_text - english, "non_english_pct": _pct(with_text - english, with_text),
            "analysed": sum(l["analysed"] for l in langs),
            "llm_enabled": llm.enabled(), "languages": langs}


@app.get("/api/issues")
def issues(props: list[str] = Props, start: date | None = From, end: date | None = To,
           polarity: Literal["positive", "negative"] = "negative", limit: int = Query(15, ge=1, le=100)):
    """Specific issues grouped into problems one fix would address (groups are built at ingest time),
    ranked by how many reviews mention them, with the previous period of equal length for comparison.
    Default period: this calendar week (see _period). Pure SQL: no LLM call."""
    per = _period(start, end)
    start, end, prev_start = per["from"], per["to"], per["previous_from"]
    w, a = _where(props, prev_start, end)
    side = "negative" if polarity == "negative" else "positive"
    cur = start.isoformat()
    with _conn() as conn:
        reviews_in_period = conn.execute(f"SELECT COUNT(*) FROM reviews r WHERE {_where(props, start, end)[0]}",
                                         _where(props, start, end)[1]).fetchone()[0]
        # Phrases not grouped yet (no API key, or not processed) count as their own group.
        rows = conn.execute(f"""
            WITH hits AS (
                SELECT COALESCE(g.id, -p.rowid) AS gid, COALESCE(g.label, i.issue) AS label,
                       COALESCE(g.topic, i.topic) AS topic, i.severity, r.id AS review_id, r.property,
                       r.score, r.reviewed_on, r.reviewed_at, r.reviewed_on >= ? AS current
                FROM review_issues i
                JOIN reviews r ON r.id = i.review_id
                LEFT JOIN issue_phrases p ON p.polarity = i.polarity AND p.issue = i.issue
                LEFT JOIN issue_groups g ON g.id = p.group_id
                WHERE {w} AND i.polarity = ?)
            SELECT gid, MIN(label) AS label, MIN(topic) AS topic,
                   COUNT(DISTINCT CASE WHEN current THEN review_id END) AS reviews,
                   COUNT(DISTINCT CASE WHEN NOT current THEN review_id END) AS previous_reviews,
                   MAX(CASE WHEN current THEN severity END) AS max_severity
            FROM hits GROUP BY gid HAVING reviews > 0
            ORDER BY reviews DESC, max_severity DESC LIMIT ?""", [cur, *a, polarity, limit]).fetchall()
        groups = [dict(r) for r in rows]
        if groups:
            # per-review detail for the returned groups only: property split, average score, examples
            gids = [g["gid"] for g in groups]
            detail = conn.execute(f"""
                SELECT DISTINCT COALESCE(p.group_id, -p.rowid) AS gid, r.id, r.property, r.score,
                       r.reviewed_on, r.reviewed_at,
                       SUBSTR(COALESCE(x.{side}_en, r.{side}), 1, 300) AS text
                FROM review_issues i
                JOIN reviews r ON r.id = i.review_id
                LEFT JOIN review_analysis x ON x.review_id = r.id
                JOIN issue_phrases p ON p.polarity = i.polarity AND p.issue = i.issue
                WHERE {_where(props, start, end)[0]} AND i.polarity = ?
                  AND COALESCE(p.group_id, -p.rowid) IN ({','.join('?' * len(gids))})
                ORDER BY r.reviewed_at DESC""", [*_where(props, start, end)[1], polarity, *gids]).fetchall()
    by_gid: dict[int, list] = {}
    for d in detail if groups else []:
        if not any(e["id"] == d["id"] for e in by_gid.get(d["gid"], [])):
            by_gid.setdefault(d["gid"], []).append(dict(d))
    result = []
    for g in groups:
        revs = by_gid.get(g["gid"], [])
        by_property: dict[str, int] = {}
        for r in revs:
            by_property[r["property"]] = by_property.get(r["property"], 0) + 1
        result.append({
            "id": g["gid"], "label": g["label"], "topic": g["topic"], "topic_label": LABELS.get(g["topic"], "Other"),
            "reviews": g["reviews"], "share_of_reviews": _pct(g["reviews"], reviews_in_period),
            "previous_reviews": g["previous_reviews"], "max_severity": g["max_severity"],
            "avg_score": round(sum(r["score"] for r in revs) / len(revs), 2) if revs else None,
            "by_property": by_property,
            "examples": [{k: r[k] for k in ("id", "property", "score", "reviewed_on", "text")} for r in revs[:3]],
        })
    return {"period": _period_json(per), "from": start.isoformat(), "to": end.isoformat(),
            "reviews_in_period": reviews_in_period, "polarity": polarity, "issues": result}


# --- briefings: stored, served instantly, regenerated in the background ---------------------------

log = logging.getLogger("api")
_inflight: set[str] = set()
_inflight_lock = threading.Lock()


def _briefing_facts(props: list[str], start: date | None, end: date | None) -> dict:
    """Everything the briefing may say, computed in SQL. Its hash decides whether a stored briefing is current."""
    ov = overview(props, start, end)
    start, end = date.fromisoformat(ov["period"]["from"]), date.fromisoformat(ov["period"]["to"])
    tp = topics(props, start, end)
    top = issues(props, start, end, "negative", 8)
    w, a = _where(props, start, end)
    with _conn() as conn:
        urgent = [dict(r) for r in conn.execute(f"""
            SELECT r.id, r.property, r.score, x.urgent_reason,
                   SUBSTR(COALESCE(x.negative_en, r.negative, x.positive_en, r.positive), 1, 800) AS text
            FROM reviews r JOIN review_analysis x ON x.review_id = r.id
            WHERE {w} AND x.urgent = 1 ORDER BY r.reviewed_at DESC LIMIT 10""", a)]
    return {
        "properties": [db.PROPERTIES[p] for p in (props or db.PROPERTIES)],
        "period": ov["period"], "current": ov["current"], "previous": ov["previous"], "avg_change": ov["avg_change"],
        "by_property": [{"name": b["name"], "current": b["current"], "previous": b["previous"]}
                        for b in ov["by_property"]] if len(props) != 1 else None,
        "topics": [{k: t[k] for k in ("label", "complained", "praised", "complaint_rate",
                                      "share_of_negative_reviews", "avg_score_when_complained")}
                   | {"complained_previous_week": t["previous"]["complained"]}
                   for t in tp["topics"] if t["complained"] or t["praised"]],
        "top_issues": [{k: i[k] for k in ("label", "reviews", "previous_reviews", "max_severity", "avg_score")}
                       | {"examples": [{k: e[k] for k in ("id", "score", "text")} for e in i["examples"][:2]]}
                       for i in top["issues"]],
        "urgent": urgent,
    }


def _scope(props: list[str], start: date | None, end: date | None) -> str:
    """Default period is 'current' (moves with the calendar); explicit ranges are their own scope."""
    rng = [start.isoformat() if start else None, end.isoformat() if end else None]
    return json.dumps([sorted(props), rng if any(rng) else "current"])


def _hash(facts: dict) -> str:
    """Facts + prompt + model: changing the prompt or model also marks stored briefings stale."""
    payload = [facts, llm.BRIEFING_PROMPT, llm.SUMMARY_MODEL]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _generate(scope: str, facts: dict, input_hash: str) -> None:
    try:
        content = llm.generate_briefing(facts)
        with _conn() as conn, conn:
            conn.execute("INSERT OR REPLACE INTO briefings VALUES (?, ?, ?, ?, ?, ?)",
                         (scope, input_hash, int(time.time()), llm.SUMMARY_MODEL,
                          json.dumps(facts, ensure_ascii=False), json.dumps(content, ensure_ascii=False)))
        log.info("briefing %s generated", scope)
    except Exception:
        log.exception("briefing %s failed", scope)
    finally:
        with _inflight_lock:
            _inflight.discard(scope)


def _start_generation(scope: str, facts: dict, input_hash: str) -> threading.Thread | None:
    """At most one generation per scope at a time."""
    with _inflight_lock:
        if scope in _inflight:
            return None
        _inflight.add(scope)
    t = threading.Thread(target=_generate, args=(scope, facts, input_hash), daemon=True)
    t.start()
    return t


def refresh_briefings(wait: bool = True) -> None:
    """Pre-generate this week's briefing for all properties and for each one, where the facts changed.
    Runs after every collection, so dashboard users normally never wait."""
    threads = []
    with _conn() as conn:
        stored = {r["scope"]: r["input_hash"] for r in conn.execute("SELECT scope, input_hash FROM briefings")}
    for props in ([], *([p] for p in db.PROPERTIES)):
        facts = _briefing_facts(props, None, None)
        scope, h = _scope(props, None, None), _hash(facts)
        if stored.get(scope) != h and (t := _start_generation(scope, facts, h)):
            threads.append(t)
    for t in threads if wait else []:
        t.join()


@app.get("/api/briefing")
def briefing(response: Response, props: list[str] = Props, start: date | None = From, end: date | None = To):
    """AI weekly briefing, always answered from storage (milliseconds).
    status: "fresh" = matches the current data; "stale" = the data changed since, a new one is being
    generated (`generating`); 202 "generating" = none stored yet for this scope, poll again."""
    facts = _briefing_facts(props, start, end)
    scope, h = _scope(props, start, end), _hash(facts)
    with _conn() as conn:
        row = conn.execute("SELECT * FROM briefings WHERE scope = ?", (scope,)).fetchone()
    fresh = row is not None and row["input_hash"] == h
    if not fresh and llm.enabled():
        _start_generation(scope, facts, h)
    generating = scope in _inflight
    if row:
        return {"status": "fresh" if fresh else "stale", "generating": generating,
                "generated_at": row["generated_at"], "model": row["model"],
                "facts": json.loads(row["facts"]), "briefing": json.loads(row["content"])}
    if not llm.enabled():
        raise HTTPException(503, "no briefing stored; set OPENAI_API_KEY in server/.env to generate one")
    response.status_code = 202
    return {"status": "generating", "generating": True, "facts": facts, "briefing": None}
