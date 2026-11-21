"""Collect Booking.com reviews with a real (headed) Chromium window.

The collector behaves like a person reading reviews: it opens the property page,
opens "Read all reviews", sorts by "Newest first" and clicks "Next page". It
reads the review data from the JSON responses the page itself requests, so no
HTML parsing and no hand-made API calls. It adds no bot-detection workarounds:
if Booking.com blocks the session, the run fails and says so.

Incremental: newest first, it stops at the first page that contains a review
it already has. --full walks every page (first run / backfill).

    python -m app.collector                         # all properties, incremental
    python -m app.collector --property chateau-de-venus --full
"""
import argparse
import asyncio
import hashlib
import logging
import os
import random
import sys
import time

from playwright.async_api import Page, Response, TimeoutError as PWTimeout, async_playwright

from . import db, llm

log = logging.getLogger("collector")
ERROR_DIR = db.DATA_DIR / "errors"
STEP_TIMEOUT_MS = 30_000


class CollectError(Exception):
    pass


def _is_newest_review_list(resp: Response) -> bool:
    body = resp.request.post_data or ""
    return ("graphql" in resp.url and body.startswith('{"operationName":"ReviewList')
            and '"sorter":"NEWEST_FIRST"' in body)


async def _review_list(resp: Response) -> tuple[list[dict], int | None]:
    """Cards plus the total review count Booking.com reports. Raises if the response is not usable."""
    if not resp.ok:
        raise CollectError(f"review request failed: HTTP {resp.status}")
    payload = await resp.json()
    if payload.get("errors"):
        raise CollectError(f"review request returned errors: {payload['errors'][0].get('message')}")
    result = (payload.get("data") or {}).get("reviewListFrontend") or {}
    cards = result.get("reviewCard")
    if not isinstance(cards, list):
        raise CollectError("review response format changed (no reviewCard list)")
    total = result.get("reviewsCount")
    return cards, total if isinstance(total, int) else None


async def _decline_cookies(page: Page) -> None:
    button = page.locator("#onetrust-reject-all-handler")
    try:
        await button.click(timeout=3_000)
    except PWTimeout:
        pass  # no banner shown


async def collect_property(page: Page, conn, prop: str, run_id: int, full: bool, max_pages: int) -> tuple[int, int]:
    nav = await page.goto(db.property_url(prop), wait_until="domcontentloaded", timeout=60_000)
    if nav and nav.status >= 500:
        raise CollectError(f"Booking.com returned HTTP {nav.status} (temporary server error)")
    if nav and nav.status in (403, 429):
        raise CollectError(f"Booking.com refused the request (HTTP {nav.status}): blocked or rate limited")
    await _decline_cookies(page)

    read_all = page.locator('[data-testid="fr-read-all-reviews"]').first
    sorter = page.locator('select[data-testid="reviews-sorter-component"]')
    for _ in range(5):  # a click before the page's scripts are ready does nothing, so click again
        try:
            await read_all.click(timeout=STEP_TIMEOUT_MS)
        except PWTimeout:
            raise CollectError("'Read all reviews' not found: page blocked or layout changed")
        try:
            await sorter.wait_for(state="visible", timeout=5_000)
            break
        except PWTimeout:
            continue
    else:
        raise CollectError("reviews panel did not open")

    async with page.expect_response(_is_newest_review_list, timeout=STEP_TIMEOUT_MS) as info:
        await sorter.select_option("NEWEST_FIRST", timeout=STEP_TIMEOUT_MS)
    resp = await info.value

    pages = seen = new = rejected = 0
    while True:
        cards, total = await _review_list(resp)
        checked = [(c, db.card_problems(c)) for c in cards]
        good = [c for c, problems in checked if not problems]
        bad = [(c, problems) for c, problems in checked if problems]
        if cards and len(bad) > len(cards) / 2:
            # most of a page failing validation means Booking.com changed its format: stop, store nothing
            raise CollectError(f"review format changed: {bad[0][1][0]}")
        db.reject(conn, run_id, prop, bad)
        added = db.upsert(conn, [db.to_row(c, prop) for c in good])
        pages, seen, new, rejected = pages + 1, seen + len(cards), new + added, rejected + len(bad)
        db.update_run(conn, run_id, pages=pages, seen=seen, new=new, rejected=rejected, reported_total=total)
        log.info("%s: page %d, %d reviews, %d new, %d rejected", prop, pages, len(cards), added, len(bad))

        caught_up = not full and added < len(good)  # newest first: a known review means the rest are known
        if not cards or caught_up or pages >= max_pages:
            break
        next_btn = page.locator('button[aria-label="Next page"]').first
        if not await next_btn.count() or await next_btn.is_disabled():
            break
        await page.wait_for_timeout(random.uniform(1_500, 3_000))  # read at a human pace
        async with page.expect_response(_is_newest_review_list, timeout=STEP_TIMEOUT_MS) as info:
            await next_btn.click()
        resp = await info.value
    return seen, new


def proxy_settings(session: str) -> dict | None:
    """Webshare residential proxy from WEBSHARE_HOST/PORT/USERNAME/PASSWORD, or None to connect directly.

    Booking.com blocks most datacenter IPs, so a hosted server needs a residential IP. The username
    is "<base>-<country>-<number>": a numeric session keeps the same IP for the whole property walk
    (Webshare rejects non-numeric session ids with 407). The password is never logged.
    """
    if os.environ.get("DISABLE_PROXY", "").lower() == "true":
        return None
    host, port = os.environ.get("WEBSHARE_HOST"), os.environ.get("WEBSHARE_PORT")
    base, password = os.environ.get("WEBSHARE_USERNAME"), os.environ.get("WEBSHARE_PASSWORD")
    if not (host and port and base and password):
        return None
    base = base.removesuffix("-rotate")
    country = os.environ.get("WEBSHARE_COUNTRY", "au").strip().lower()
    sticky = str(int(hashlib.sha256(session.encode()).hexdigest()[:8], 16))
    username = "-".join(x for x in (base, country, sticky) if x)
    return {"server": f"http://{host}:{port}", "username": username, "password": password}


RETRY_WAIT_S = (10, 60)  # between attempts: transient 5xx errors usually clear within a minute


async def run(props: list[str], full: bool, max_pages: int, attempts: int = 3) -> int:
    """Collect each property in turn; one failing property doesn't stop the others. Returns failures."""
    conn = db.connect()
    db.fail_stale_runs(conn)
    failures = 0
    async with async_playwright() as p:
        # Headed on purpose: Booking.com refuses headless browsers, and we don't disguise one.
        # On a server without a screen, run under a virtual display (xvfb-run; the Docker image does).
        browser = await p.chromium.launch(headless=False)
        for prop in props:
            run_id = db.start_run(conn, prop)
            for attempt in range(1, attempts + 1):
                # a new residential IP per attempt, the same IP for every page of one attempt
                proxy = proxy_settings(f"{prop}-{run_id}-{attempt}")
                log.info("%s: connecting %s", prop, f"through proxy as {proxy['username']}" if proxy else "directly")
                context = await browser.new_context(locale="en-GB", viewport={"width": 1400, "height": 900},
                                                    timezone_id="Australia/Sydney", proxy=proxy)
                page = await context.new_page()
                try:
                    seen, new = await collect_property(page, conn, prop, run_id, full, max_pages)
                    db.finish_run(conn, run_id, "ok")
                    log.info("%s: done, %d seen, %d new", prop, seen, new)
                    break
                except Exception as e:
                    error = f"{type(e).__name__}: {e}".splitlines()[0][:500]
                    ERROR_DIR.mkdir(parents=True, exist_ok=True)
                    try:
                        await page.screenshot(path=ERROR_DIR / f"{prop}-{int(time.time())}.png")
                    except Exception:
                        pass
                    if attempt == attempts:
                        db.finish_run(conn, run_id, "failed", error)
                        log.error("%s: failed: %s", prop, error)
                        failures += 1
                    else:
                        log.warning("%s: attempt %d failed (%s), retrying", prop, attempt, error)
                        await asyncio.sleep(RETRY_WAIT_S[min(attempt, len(RETRY_WAIT_S)) - 1])
                finally:
                    await context.close()
        await browser.close()
    return failures


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--property", action="append", choices=list(db.PROPERTIES),
                    help="property slug (repeatable); default: all four")
    ap.add_argument("--full", action="store_true", help="walk every page instead of stopping at known reviews")
    ap.add_argument("--max-pages", type=int, default=100, help="safety cap per property (10 reviews per page)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    failures = asyncio.run(run(args.property or list(db.PROPERTIES), args.full, args.max_pages))
    if llm.enabled():  # analyse and group what was just collected, refresh briefings
        llm.process_new()
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
