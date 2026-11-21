"""Measure topic tagging against hand labels.

    python -m eval.evaluate sheet     # write eval/labels.csv: 50 random written reviews to label by hand
    python -m eval.evaluate score     # compare AI and keyword tags with your labels

In labels.csv, for each topic column write "-" (or "n") if the guest complains about it, "+" (or "p")
if they praise it, "+-" for both, and leave it empty if it isn't mentioned. Put "y" in `urgent` for health, safety,
security or legal risks.
"""
import csv
import random
import sys
from pathlib import Path

from app import db
from app.topics import LABELS, tag

SHEET = Path(__file__).parent / "labels.csv"
TOPICS = list(LABELS)


def write_sheet(n: int = 50, seed: int = 7) -> None:
    conn = db.connect()
    rows = conn.execute("""
        SELECT r.id, r.property, r.score, r.lang,
               COALESCE(x.title_en, r.title) AS title,
               COALESCE(x.positive_en, r.positive) AS liked,
               COALESCE(x.negative_en, r.negative) AS disliked
        FROM reviews r JOIN review_analysis x ON x.review_id = r.id
        WHERE r.positive IS NOT NULL OR r.negative IS NOT NULL""").fetchall()
    sample = random.Random(seed).sample(rows, n)
    with SHEET.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "property", "score", "lang", "title", "liked", "disliked", *TOPICS, "urgent"])
        for r in sample:
            w.writerow([r["id"], r["property"], r["score"], r["lang"], r["title"], r["liked"], r["disliked"],
                        *[""] * len(TOPICS), ""])
    print(f"wrote {SHEET} ({n} reviews); fill in the topic columns, then run: python -m eval.evaluate score")


def _labels(cell: str) -> set[str]:
    return {"positive" if c in "+p" else "negative" for c in cell.strip().lower() if c in "+-pn"}


def score() -> None:
    conn = db.connect()
    rows = list(csv.DictReader(SHEET.open()))
    truth, ai, kw = set(), set(), set()
    for r in rows:
        for t in TOPICS:
            truth |= {(r["id"], t, p) for p in _labels(r[t])}
        ai |= {(r["id"], t["topic"], t["polarity"]) for t in conn.execute(
            "SELECT topic, polarity FROM review_topics WHERE review_id = ?", (r["id"],))}
        orig = conn.execute("SELECT positive, negative FROM reviews WHERE id = ?", (r["id"],)).fetchone()
        kw |= {(r["id"], t, p) for t, p in tag(orig["positive"], orig["negative"])}

    def report(name: str, pred: set) -> None:
        tp = len(pred & truth)
        precision = tp / len(pred) if pred else 0
        recall = tp / len(truth) if truth else 0
        print(f"{name:9} precision {precision:.0%}  recall {recall:.0%}  "
              f"(right {tp}, wrong {len(pred - truth)}, missed {len(truth - pred)})")

    print(f"{len(rows)} reviews, {len(truth)} hand-labelled topic mentions")
    report("AI", ai)
    report("Keywords", kw)
    print("\nPer topic, AI (precision / recall):")
    for t in TOPICS:
        tt = {x for x in truth if x[1] == t}
        pp = {x for x in ai if x[1] == t}
        hit = len(tt & pp)
        print(f"  {LABELS[t]:16} {hit / len(pp) if pp else 0:.0%} / {hit / len(tt) if tt else 0:.0%}  ({len(tt)} labelled)")
    urgent_truth = {r["id"] for r in rows if r["urgent"].strip().lower() == "y"}
    urgent_ai = {r["id"] for r in rows if conn.execute(
        "SELECT urgent FROM review_analysis WHERE review_id = ?", (r["id"],)).fetchone()[0]}
    print(f"\nUrgent: you flagged {len(urgent_truth)}, AI flagged {len(urgent_ai)}, both {len(urgent_truth & urgent_ai)}")


if __name__ == "__main__":
    {"sheet": write_sheet, "score": score}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
