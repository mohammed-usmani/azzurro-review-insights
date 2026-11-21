"""Rule-based topic tagging.

Booking.com splits every review into a "liked" (positive) and "disliked" (negative)
text, so polarity comes from which field a keyword appears in. That sidesteps
negation handling: "no noise" in the liked text is praise, "noisy" in the
disliked text is a complaint.
"""
import re

LABELS = {
    "cleanliness": "Cleanliness",
    "check_in": "Check-in",
    "staff": "Staff",
    "noise": "Noise",
    "facilities": "Facilities",
    "location": "Location",
    "room_condition": "Room condition",
    "value": "Value for money",
}

# Each alternative is matched from a word start, so "clean" also covers
# "cleaner", "cleaning", "uncleaned" is listed separately.
_KEYWORDS = {
    "cleanliness": r"clean|unclean|dirt|dust|stain|filth|grim[ey]|hygien|smell|stink|odou?r|"
                   r"mou?ld|musty|cockroach|roach|bed ?bugs?\b|bugs?\b|insects?\b|hairs?\b|"
                   r"spotless|tidy|untidy|messy|sticky|gross",
    "check_in": r"check[- ]?in|check[- ]?out|reception|front desk|arriv|keys?\b|key ?card|keypad|"
                r"codes?\b|lock ?box|self[- ]?check|robo|zoom|video call|kiosk|instructions|luggage",
    "staff": r"staff|receptionists?\b|manager|hosts?\b|owner|employee|team\b|personnel|service|"
             r"friendly|unfriendly|helpful|unhelpful|rude|polite|welcom|attentive|accommodating",
    "noise": r"nois|loud|quiet|slam|thin walls?|sound ?proof|traffic|music|part(?:y|ies)\b|"
             r"earplugs?|snor|bang|construction|hear\b|heard|neighbou?rs?\b",
    "facilities": r"lifts?\b|elevator|kitchen|wi-?fi|internet|parking|car park|air ?con|a/c\b|"
                  r"air conditioning|heating|heater|laundry|washing machine|pool\b|gym\b|breakfast|"
                  r"facilit|amenit|common (?:area|room)|lounge|fridge|microwave|kettle|vending|"
                  r"shared bathroom|toiletries|shower gel|shampoo|soap|towels?\b",
    "location": r"locat|close to|near(?:by)?\b|walk|station|train|bus\b|buses|tram|metro|transport|"
                r"central|city\b|cbd\b|neighbou?rhood|area\b|suburb|convenient|restaurants?\b|"
                r"cafes?\b|shops\b|beach|harbou?r|airport",
    "room_condition": r"rooms?\b|beds?\b|mattress|pillow|sheets?\b|linen|blanket|duvet|shower\b|"
                      r"bathroom|toilet|window|furniture|carpet|curtain|tv\b|television|old\b|dated|"
                      r"worn|tired|broken|damage|repair|maintenance|renovat|cramped|tiny|small|"
                      r"spacious|comfortable|comfy|uncomfortable|ventilat|stuffy|leak|peeling|cracked",
    "value": r"value|pric|money|cheap|expensive|overpriced|worth|cost|budget|afford|paid\b|pay\b|"
             r"rates?\b|bargain|deal\b|refund|charge|fees?\b",
}
TOPICS = {k: re.compile(rf"\b(?:{v})", re.IGNORECASE) for k, v in _KEYWORDS.items()}

# "Nothing", "Nothing really.", "No complaints" etc. in the disliked field mean
# there is no complaint, so they must not be tagged.
_NO_COMPLAINT = re.compile(
    r"(?:nothing|none|n/?a|nil|no|no complaints?|-+|\.+)"
    r"(?: (?:really|at all|much|to (?:report|complain about|dislike|say)))?[.!]*",
    re.IGNORECASE,
)


def topics_in(text: str | None) -> set[str]:
    if not text:
        return set()
    return {topic for topic, rx in TOPICS.items() if rx.search(text)}


def tag(positive: str | None, negative: str | None) -> set[tuple[str, str]]:
    """Return {(topic, "positive"|"negative")} for one review."""
    if negative and _NO_COMPLAINT.fullmatch(negative.strip()):
        negative = None
    return {(t, "positive") for t in topics_in(positive)} | {(t, "negative") for t in topics_in(negative)}
