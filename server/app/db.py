"""SQLite storage: schema, review upserts, run log, sample data import/export.

CLI:
    python -m app.db load-sample   # load data/sample_reviews.json into the DB
    python -m app.db export        # write the DB to data/sample_reviews.json
    python -m app.db retag         # re-run topic tagging after changing keywords
"""
import html
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .topics import tag

SERVER_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = SERVER_DIR / "data"
DB_PATH = Path(os.environ.get("REVIEWS_DB", DATA_DIR / "reviews.db"))
SAMPLE_PATH = DATA_DIR / "sample_reviews.json"
TZ = ZoneInfo("Australia/Sydney")  # all four properties are in Sydney

# Booking.com URL slug -> display name
PROPERTIES = {
    "olympic-paddington": "Olympic Hotel Paddington",
    "venus-potts-point-sydney": "Potts Point",
    "venus-surry-hills": "Central Sydney",
    "chateau-de-venus": "Darling Harbour",
}


def property_url(slug: str) -> str:
    return f"https://www.booking.com/hotel/au/{slug}.en-gb.html"


SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id             TEXT PRIMARY KEY,   -- Booking.com reviewUrl: stable and unique per review
    property       TEXT NOT NULL,
    score          REAL NOT NULL,      -- 1-10
    reviewed_at    INTEGER NOT NULL,   -- unix seconds
    reviewed_on    TEXT NOT NULL,      -- YYYY-MM-DD in Sydney time, used for filters and buckets
    title          TEXT,
    positive       TEXT,
    negative       TEXT,
    lang           TEXT,
    checkin        TEXT,
    checkout       TEXT,
    nights         INTEGER,
    room_type      TEXT,
    traveller_type TEXT,
    partner_reply  TEXT,
    first_seen_at  INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_property_day ON reviews(property, reviewed_on);
CREATE INDEX IF NOT EXISTS reviews_day ON reviews(reviewed_on);

CREATE TABLE IF NOT EXISTS review_topics (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    topic     TEXT NOT NULL,
    polarity  TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
    PRIMARY KEY (review_id, topic, polarity)
);
CREATE INDEX IF NOT EXISTS review_topics_topic ON review_topics(topic, polarity);

-- LLM enrichment (app/llm.py). When present it replaces the keyword tags in review_topics.
CREATE TABLE IF NOT EXISTS review_analysis (
    review_id      TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    prompt_version INTEGER NOT NULL,
    analyzed_at    INTEGER NOT NULL,
    title_en       TEXT,              -- English translations, NULL when the review is already English
    positive_en    TEXT,
    negative_en    TEXT,
    urgent         INTEGER NOT NULL DEFAULT 0,  -- health, safety, security or legal risk
    urgent_reason  TEXT
);
CREATE TABLE IF NOT EXISTS review_issues (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    topic     TEXT NOT NULL,          -- one of topics.LABELS or 'other'
    polarity  TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
    issue     TEXT NOT NULL,          -- short specific English phrase, e.g. "door code did not work"
    severity  INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 3)
);
CREATE INDEX IF NOT EXISTS review_issues_review ON review_issues(review_id);
CREATE INDEX IF NOT EXISTS review_issues_phrase ON review_issues(polarity, issue);

-- Issue phrases grouped into problems one fix would address (llm.group_phrases), so that
-- /api/issues is a SQL query instead of an LLM call per request.
CREATE TABLE IF NOT EXISTS issue_groups (
    id       INTEGER PRIMARY KEY,
    polarity TEXT NOT NULL,
    topic    TEXT NOT NULL,           -- topic of the seed phrase
    label    TEXT NOT NULL,           -- most frequent phrase at creation, then an LLM-written name
    reviewed INTEGER NOT NULL DEFAULT 0  -- 1 once llm.merge_groups has considered it
);
CREATE TABLE IF NOT EXISTS issue_phrases (
    polarity  TEXT NOT NULL,
    issue     TEXT NOT NULL,
    embedding BLOB,                   -- float32 vector, NULL until embedded
    group_id  INTEGER REFERENCES issue_groups(id),
    PRIMARY KEY (polarity, issue)
);

-- Latest briefing per scope (property selection + week). Served instantly; regenerated in the
-- background when the facts behind it change (input_hash).
CREATE TABLE IF NOT EXISTS briefings (
    scope        TEXT PRIMARY KEY,
    input_hash   TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    model        TEXT NOT NULL,
    facts        TEXT NOT NULL,
    content      TEXT NOT NULL
);
DROP TABLE IF EXISTS llm_cache;

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY,
    property    TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
    pages       INTEGER NOT NULL DEFAULT 0,
    seen        INTEGER NOT NULL DEFAULT 0,
    new         INTEGER NOT NULL DEFAULT 0,
    rejected    INTEGER NOT NULL DEFAULT 0,
    reported_total INTEGER,           -- review count Booking.com shows for the property
    error       TEXT
);

-- Reviews that failed validation (no review content stored: only why it was rejected)
CREATE TABLE IF NOT EXISTS rejected_reviews (
    id        INTEGER PRIMARY KEY,
    run_id    INTEGER NOT NULL REFERENCES runs(id),
    property  TEXT NOT NULL,
    review_id TEXT,
    reason    TEXT NOT NULL,
    seen_at   INTEGER NOT NULL
);
"""

COLS = ["id", "property", "score", "reviewed_at", "reviewed_on", "title", "positive", "negative",
        "lang", "checkin", "checkout", "nights", "room_type", "traveller_type", "partner_reply"]


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # API reads while the collector writes
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


# Columns added after a table first shipped: CREATE TABLE IF NOT EXISTS won't add them to an existing DB.
_ADDED_COLUMNS = [("runs", "rejected", "INTEGER NOT NULL DEFAULT 0"), ("runs", "reported_total", "INTEGER")]


def _migrate(conn) -> None:
    for table, col, ddl in _ADDED_COLUMNS:
        if col not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")


def _clean(s: str | None) -> str | None:
    s = html.unescape(s).strip() if s else None
    return s or None


def card_problems(card: dict) -> list[str]:
    """Data-quality checks on one ReviewCard before it is stored. An empty list means valid."""
    problems = []
    if not isinstance(card.get("reviewUrl"), str) or not card["reviewUrl"]:
        problems.append("missing review id")
    score = card.get("reviewScore")
    if not isinstance(score, (int, float)) or not 1 <= score <= 10:
        problems.append(f"score outside 1-10: {score!r}")
    ts = card.get("reviewedDate")
    if not isinstance(ts, (int, float)):
        problems.append("missing review date")
    elif not 946684800 <= ts <= time.time() + 86400:  # 2000-01-01 .. tomorrow
        problems.append(f"implausible review date: {ts}")
    if not isinstance(card.get("textDetails"), dict):
        problems.append("missing text details")
    return problems


def reject(conn, run_id: int, prop: str, rejected: list[tuple[dict, list[str]]]) -> None:
    with conn:
        conn.executemany("INSERT INTO rejected_reviews (run_id, property, review_id, reason, seen_at) "
                         "VALUES (?, ?, ?, ?, ?)",
                         [(run_id, prop, c.get("reviewUrl") if isinstance(c.get("reviewUrl"), str) else None,
                           "; ".join(problems), int(time.time())) for c, problems in rejected])


def to_row(card: dict, prop: str) -> dict:
    """Map one Booking.com ReviewCard to a reviews row. guestDetails (name, avatar,
    country) is personal data and deliberately not stored."""
    text = card.get("textDetails") or {}
    stay = card.get("bookingDetails") or {}
    ts = int(card["reviewedDate"])
    return {
        "id": card["reviewUrl"],
        "property": prop,
        "score": float(card["reviewScore"]),
        "reviewed_at": ts,
        "reviewed_on": datetime.fromtimestamp(ts, TZ).date().isoformat(),
        "title": _clean(text.get("title")),
        "positive": _clean(text.get("positiveText")),
        "negative": _clean(text.get("negativeText")),
        "lang": text.get("lang"),
        "checkin": stay.get("checkinDate"),
        "checkout": stay.get("checkoutDate"),
        "nights": stay.get("numNights"),
        "room_type": (stay.get("roomType") or {}).get("name"),
        "traveller_type": stay.get("customerType"),
        "partner_reply": _clean((card.get("partnerReply") or {}).get("reply")),
    }


_UPSERT = f"""
INSERT INTO reviews ({", ".join(COLS)}, first_seen_at, last_seen_at)
VALUES ({", ".join(":" + c for c in COLS)}, :now, :now)
ON CONFLICT(id) DO UPDATE SET
    {", ".join(f"{c} = excluded.{c}" for c in COLS if c != "id")},
    last_seen_at = excluded.last_seen_at
"""


TEXT_COLS = ("title", "positive", "negative")


def upsert(conn: sqlite3.Connection, rows: list[dict]) -> int:
    """Insert new reviews, refresh known ones (edits, hotel replies). Returns the number of new ids.
    A review whose text changed loses its LLM analysis and falls back to keyword tags until re-analysed."""
    now = int(time.time())
    new = 0
    with conn:
        for r in rows:
            old = conn.execute("SELECT title, positive, negative, "
                               "EXISTS (SELECT 1 FROM review_analysis WHERE review_id = id) AS analysed "
                               "FROM reviews WHERE id = ?", (r["id"],)).fetchone()
            new += old is None
            conn.execute(_UPSERT, {**r, "now": now})
            if old and old["analysed"] and all(old[c] == r[c] for c in TEXT_COLS):
                continue  # unchanged and already analysed: keep the LLM tags
            conn.execute("DELETE FROM review_analysis WHERE review_id = ?", (r["id"],))
            conn.execute("DELETE FROM review_issues WHERE review_id = ?", (r["id"],))
            _replace_topics(conn, r["id"], tag(r["positive"], r["negative"]))
    return new


def _replace_topics(conn, review_id: str, tags) -> None:
    conn.execute("DELETE FROM review_topics WHERE review_id = ?", (review_id,))
    conn.executemany("INSERT INTO review_topics VALUES (?, ?, ?)", [(review_id, t, p) for t, p in tags])


def save_analysis(conn, review_id: str, a: dict, model: str, prompt_version: int) -> None:
    """Store one LLM analysis: translations, urgent flag, specific issues, and topic tags derived from them."""
    from .topics import LABELS
    issues = a.get("issues") or []
    with conn:
        conn.execute("INSERT OR REPLACE INTO review_analysis VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (review_id, model, prompt_version, int(time.time()), a.get("title_en"),
                      a.get("positive_en"), a.get("negative_en"), int(bool(a.get("urgent"))), a.get("urgent_reason")))
        conn.execute("DELETE FROM review_issues WHERE review_id = ?", (review_id,))
        conn.executemany("INSERT INTO review_issues VALUES (?, ?, ?, ?, ?)",
                         [(review_id, i["topic"], i["polarity"], i["issue"], i["severity"]) for i in issues])
        conn.executemany("INSERT OR IGNORE INTO issue_phrases (polarity, issue) VALUES (?, ?)",
                         [(i["polarity"], i["issue"]) for i in issues])
        _replace_topics(conn, review_id, {(i["topic"], i["polarity"]) for i in issues if i["topic"] in LABELS})


# --- run log -------------------------------------------------------------------

def start_run(conn, prop: str) -> int:
    with conn:
        return conn.execute("INSERT INTO runs (property, started_at, status) VALUES (?, ?, 'running')",
                            (prop, int(time.time()))).lastrowid


def update_run(conn, run_id: int, **fields) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with conn:
        conn.execute(f"UPDATE runs SET {sets} WHERE id = ?", (*fields.values(), run_id))


def finish_run(conn, run_id: int, status: str, error: str | None = None) -> None:
    update_run(conn, run_id, status=status, error=error, finished_at=int(time.time()))


def fail_stale_runs(conn) -> None:
    """A collector killed mid-run leaves 'running' rows behind; close them."""
    with conn:
        conn.execute("UPDATE runs SET status = 'failed', error = 'interrupted', finished_at = ? "
                     "WHERE status = 'running'", (int(time.time()),))


# --- sample data ------------------------------------------------------------------

ANALYSIS_COLS = ["model", "prompt_version", "title_en", "positive_en", "negative_en", "urgent", "urgent_reason"]


def export_sample(conn, path: Path = SAMPLE_PATH) -> int:
    """Reviews plus LLM analysis, issue groups and briefings, so the sample works without an API key.
    Embeddings are left out (large); they are recomputed when a key is set."""
    issues: dict[str, list] = {}
    for i in conn.execute("SELECT * FROM review_issues ORDER BY rowid"):
        issues.setdefault(i["review_id"], []).append({k: i[k] for k in ("topic", "polarity", "issue", "severity")})
    analyses = {a["review_id"]: {k: a[k] for k in ANALYSIS_COLS} for a in conn.execute("SELECT * FROM review_analysis")}
    rows = []
    for r in conn.execute(f"SELECT {', '.join(COLS)} FROM reviews ORDER BY property, reviewed_at DESC"):
        row = {c: r[c] for c in COLS}
        if r["id"] in analyses:
            row["analysis"] = {**analyses[r["id"]], "issues": issues.get(r["id"], [])}
        rows.append(row)
    data = {
        "reviews": rows,
        "issue_groups": [dict(g) for g in conn.execute("SELECT * FROM issue_groups ORDER BY id")],
        "issue_phrases": [dict(p) for p in conn.execute(
            "SELECT polarity, issue, group_id FROM issue_phrases WHERE group_id IS NOT NULL ORDER BY group_id")],
        "briefings": [dict(b) for b in conn.execute("SELECT * FROM briefings")],
        # latest successful run per property, so the health panel shows when the sample was collected
        "runs": [dict(r) for r in conn.execute(
            "SELECT * FROM runs WHERE id IN (SELECT MAX(id) FROM runs WHERE status = 'ok' GROUP BY property)")],
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    return len(rows)


def load_sample(conn, path: Path = SAMPLE_PATH) -> int:
    data = json.loads(path.read_text())
    rows = data["reviews"]
    upsert(conn, [{c: r.get(c) for c in COLS} for r in rows])
    for r in rows:
        if a := r.get("analysis"):
            save_analysis(conn, r["id"], a, a["model"], a["prompt_version"])
    with conn:
        conn.executemany("INSERT OR REPLACE INTO issue_groups VALUES (:id, :polarity, :topic, :label, :reviewed)",
                         data.get("issue_groups", []))
        conn.executemany("INSERT OR REPLACE INTO issue_phrases (polarity, issue, group_id) "
                         "VALUES (:polarity, :issue, :group_id)", data.get("issue_phrases", []))
        conn.executemany("INSERT OR REPLACE INTO briefings VALUES (:scope, :input_hash, :generated_at, "
                         ":model, :facts, :content)", data.get("briefings", []))
        for r in data.get("runs", []):
            conn.execute(f"INSERT OR REPLACE INTO runs ({', '.join(r)}) VALUES ({', '.join('?' * len(r))})",
                         list(r.values()))
    return len(rows)


def retag(conn) -> int:
    """Re-run keyword tagging for reviews without an LLM analysis."""
    rows = conn.execute(f"SELECT id, positive, negative FROM reviews WHERE id NOT IN "
                        f"(SELECT review_id FROM review_analysis)").fetchall()
    with conn:
        for r in rows:
            _replace_topics(conn, r["id"], tag(r["positive"], r["negative"]))
    return len(rows)


if __name__ == "__main__":
    commands = {"load-sample": load_sample, "export": export_sample, "retag": retag}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(f"usage: python -m app.db {{{'|'.join(commands)}}}")
    n = commands[sys.argv[1]](connect())
    print(f"{sys.argv[1]}: {n} reviews ({DB_PATH})")
