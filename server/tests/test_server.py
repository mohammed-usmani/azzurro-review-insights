from datetime import date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient

from app import db
from app.topics import tag


def card(rid, score, day: date, positive=None, negative=None, reply=None):
    ts = int(datetime.combine(day, time(12), db.TZ).timestamp())
    return {
        "reviewUrl": rid, "reviewScore": score, "reviewedDate": ts,
        "textDetails": {"title": "t", "positiveText": positive, "negativeText": negative, "lang": "en"},
        "bookingDetails": {"checkinDate": "2026-11-01", "checkoutDate": "2026-11-02", "numNights": 1,
                           "roomType": {"name": "Double"}, "customerType": "COUPLES"},
        "partnerReply": {"reply": reply} if reply else None,
        "guestDetails": {"username": "Jane", "countryName": "Australia"},
    }


def test_tagging_uses_field_for_polarity():
    tags = tag("Very clean, friendly staff, great location", "No lift and noisy at night")
    assert {("cleanliness", "positive"), ("staff", "positive"), ("location", "positive"),
            ("facilities", "negative"), ("noise", "negative")} <= tags
    assert ("noise", "positive") in tag("It's quiet. No noise", None)
    assert tag(None, "Nothing really.") == set()       # "nothing" is not a complaint
    assert tag(None, "Nothing, except the slamming doors") == {("noise", "negative")}


def test_to_row_drops_personal_data_and_unescapes():
    row = db.to_row(card("a", 7, date(2026, 11, 10), reply="We&#39;re sorry"), "olympic-paddington")
    assert row["partner_reply"] == "We're sorry"
    assert row["reviewed_on"] == "2026-11-10"
    assert not any("Jane" in str(v) for v in row.values())


def test_upsert_is_idempotent_and_refreshes(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    rows = [db.to_row(card("a", 5, date(2026, 11, 10), negative="dirty room"), "olympic-paddington")]
    assert db.upsert(conn, rows) == 1
    rows[0]["partner_reply"] = "Thanks"
    assert db.upsert(conn, rows) == 0
    assert conn.execute("SELECT COUNT(*), MAX(partner_reply) FROM reviews").fetchone()[:] == (1, "Thanks")
    assert conn.execute("SELECT COUNT(*) FROM review_topics WHERE review_id='a'").fetchone()[0] == 2  # no dup tags


ANALYSIS = {"title_en": "Bad", "positive_en": None, "negative_en": "The bathroom was dirty",
            "urgent": True, "urgent_reason": "cockroaches",
            "issues": [{"topic": "cleanliness", "polarity": "negative", "issue": "shared bathroom not cleaned", "severity": 2},
                       {"topic": "other", "polarity": "positive", "issue": "free pasta dinner", "severity": 1}]}


def test_analysis_survives_recollection_until_text_changes(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    row = db.to_row(card("a", 4, date(2026, 11, 10), negative="Salle de bain sale"), "olympic-paddington")
    db.upsert(conn, [row])
    db.save_analysis(conn, "a", ANALYSIS, "m", 1)
    topics = lambda: {tuple(r) for r in conn.execute("SELECT topic, polarity FROM review_topics")}
    assert topics() == {("cleanliness", "negative")}            # LLM tags replace keyword tags, 'other' excluded
    db.upsert(conn, [row])                                       # re-collected unchanged: analysis kept
    assert conn.execute("SELECT COUNT(*) FROM review_issues").fetchone()[0] == 2
    db.upsert(conn, [{**row, "negative": "edited text"}])         # edited: analysis dropped, keyword fallback
    assert conn.execute("SELECT COUNT(*) FROM review_analysis").fetchone()[0] == 0


def test_sample_roundtrip_keeps_analysis(tmp_path):
    conn = db.connect(tmp_path / "a.db")
    db.upsert(conn, [db.to_row(card("a", 4, date(2026, 11, 10), negative="x"), "olympic-paddington")])
    db.save_analysis(conn, "a", ANALYSIS, "m", 1)
    db.export_sample(conn, tmp_path / "s.json")
    conn2 = db.connect(tmp_path / "b.db")
    db.load_sample(conn2, tmp_path / "s.json")
    assert conn2.execute("SELECT urgent_reason FROM review_analysis").fetchone()[0] == "cockroaches"
    assert conn2.execute("SELECT COUNT(*) FROM review_issues").fetchone()[0] == 2


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import llm
    monkeypatch.setattr(llm, "enabled", lambda: False)  # never call OpenAI from tests
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "api.db")
    as_of = date(2026, 11, 20)
    p = "olympic-paddington"
    db.upsert(db.connect(), [db.to_row(c, prop) for c, prop in [
        (card("t1", 4, as_of, negative="Bathroom was dirty"), p),           # this week, negative, cleanliness
        (card("t2", 5, as_of - timedelta(days=2), negative="Very noisy"), p),  # this week, negative, noise
        (card("t3", 9, as_of - timedelta(days=3), positive="Lovely staff"), "chateau-de-venus"),
        (card("l1", 8, as_of - timedelta(days=8), negative="a bit dirty"), p),  # last week
        (card("o1", 10, as_of - timedelta(days=30)), p),                     # outside both weeks
    ]])
    from app.api import app
    return TestClient(app)


def test_overview_compares_weeks(client):
    # Fri 20 Nov: this calendar week is Mon 16 - Fri 20, compared with Mon 9 - Sun 15
    body = client.get("/api/overview", params={"from": "2026-11-16", "to": "2026-11-20"}).json()
    assert body["period"]["previous_from"] == "2026-11-09" and body["period"]["previous_to"] == "2026-11-15"
    assert body["current"]["reviews"] == 3 and body["current"]["avg_score"] == 6.0
    assert body["previous"]["avg_score"] == 8.0 and body["avg_change"] == -2.0
    olympic = next(b for b in body["by_property"] if b["property"] == "olympic-paddington")
    assert olympic["current"]["negative"] == 2


def test_topics_insight(client):
    body = client.get("/api/topics", params={"from": "2026-11-14", "to": "2026-11-20"}).json()
    clean = next(t for t in body["topics"] if t["topic"] == "cleanliness")
    assert clean["share_of_negative_reviews"] == 50.0 and clean["previous"]["complained"] == 1
    assert any(i.startswith("50% of negative reviews") and "cleanliness" in i for i in body["insights"])


def test_reviews_filters(client):
    body = client.get("/api/reviews", params={"topic": "cleanliness", "polarity": "negative"}).json()
    assert {r["id"] for r in body["items"]} == {"t1", "l1"}
    body = client.get("/api/reviews", params={"property": "chateau-de-venus", "from": "2026-11-14"}).json()
    assert body["total"] == 1 and body["items"][0]["topics"] == [{"topic": "staff", "polarity": "positive"}]
    assert client.get("/api/reviews", params={"property": "nope"}).status_code == 400


def test_trends_fill_empty_weeks(client):
    body = client.get("/api/trends", params={"from": "2026-10-19", "to": "2026-11-20"}).json()
    assert len(body["buckets"]) == 5 and body["buckets"][0]["bucket"] == "2026-10-19"  # Mondays
    assert sum(b["reviews"] for b in body["buckets"]) == 5


def test_issues_urgent_and_briefing_without_llm(client):
    conn = db.connect()
    db.save_analysis(conn, "t1", ANALYSIS, "m", 1)
    body = client.get("/api/issues", params={"from": "2026-11-14", "to": "2026-11-20"}).json()
    assert body["issues"][0]["label"] == "shared bathroom not cleaned" and body["issues"][0]["reviews"] == 1
    assert body["issues"][0]["examples"][0]["text"] == "The bathroom was dirty"   # English translation shown
    urgent = client.get("/api/reviews", params={"urgent": True}).json()
    assert [r["id"] for r in urgent["items"]] == ["t1"] and urgent["items"][0]["issues"]
    gid = body["issues"][0]["id"]
    assert [r["id"] for r in client.get("/api/reviews", params={"issue_group": gid}).json()["items"]] == ["t1"]
    assert client.get("/api/reviews", params={"replied": False}).json()["total"] == 5
    assert client.get("/api/briefing").status_code == 503
    assert client.get("/api/coverage").json()["analysed"] == 1


def test_group_phrases_incremental(tmp_path):
    import numpy as np
    from app import llm
    conn = db.connect(tmp_path / "g.db")
    e = np.eye(llm.EMBED_DIMS, dtype=np.float32)
    near = (e[0] + 0.2 * e[1]) / np.linalg.norm(e[0] + 0.2 * e[1])
    for issue, v in [("bathroom not cleaned", e[0]), ("dirty shared bathroom", near), ("no lift", e[2])]:
        conn.execute("INSERT INTO issue_phrases VALUES ('negative', ?, ?, NULL)", (issue, v.tobytes()))
    assert llm.group_phrases(conn, threshold=0.9) == 3
    groups = dict(conn.execute("SELECT issue, group_id FROM issue_phrases").fetchall())
    assert groups["bathroom not cleaned"] == groups["dirty shared bathroom"] != groups["no lift"]
    conn.execute("INSERT INTO issue_phrases VALUES ('negative', 'bathrooms filthy', ?, NULL)", (e[0].tobytes(),))
    assert llm.group_phrases(conn, threshold=0.9) == 1          # only the new phrase is assigned
    assert conn.execute("SELECT group_id FROM issue_phrases WHERE issue='bathrooms filthy'").fetchone()[0] \
        == groups["bathroom not cleaned"]


def test_briefing_served_from_storage(client, monkeypatch):
    from app import api, llm
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm, "generate_briefing", lambda facts: {"headline": "h", "what_changed": [], "actions": []})
    first = client.get("/api/briefing", params={"from": "2026-11-16", "to": "2026-11-20"})
    assert first.status_code == 202 and first.json()["status"] == "generating"
    for t in list(__import__("threading").enumerate()):
        if t.daemon and t.name != "MainThread":
            t.join(timeout=5)
    body = client.get("/api/briefing", params={"from": "2026-11-16", "to": "2026-11-20"}).json()
    assert body["status"] == "fresh" and body["briefing"]["headline"] == "h"
    db.upsert(db.connect(), [db.to_row(card("n1", 2, date(2026, 11, 19), negative="awful"), "olympic-paddington")])
    stale = client.get("/api/briefing", params={"from": "2026-11-16", "to": "2026-11-20"}).json()
    assert stale["status"] == "stale" and stale["briefing"]["headline"] == "h"   # old one served instantly


def test_card_validation():
    good = card("a", 8, date(2026, 11, 10))
    assert db.card_problems(good) == []
    assert "score outside 1-10: 11" in db.card_problems({**good, "reviewScore": 11})
    assert db.card_problems({**good, "reviewedDate": 4102444800})[0].startswith("implausible review date")  # 2100
    assert "missing review id" in db.card_problems({**good, "reviewUrl": None})


def test_health_reports_coverage(client):
    conn = db.connect()
    run = db.start_run(conn, "olympic-paddington")
    db.update_run(conn, run, reported_total=6)
    db.finish_run(conn, run, "ok")
    body = client.get("/api/health").json()
    olympic = next(p for p in body["properties"] if p["property"] == "olympic-paddington")
    assert olympic["status"] == "ok" and olympic["stored_reviews"] == 4 and olympic["reported_reviews"] == 6
    assert body["status"] == "stale"  # the other properties were never collected
