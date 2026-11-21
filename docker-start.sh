#!/bin/sh
# Container entry: virtual screen for the (headed) collector, sample data on first start, then API + dashboard.
set -e
Xvfb :99 -screen 0 1400x900x24 -nolisten tcp >/dev/null 2>&1 &
cd /app/server
[ -f "$REVIEWS_DB" ] || uv run --no-sync python -m app.db load-sample
uv run --no-sync uvicorn app.api:app --host 127.0.0.1 --port 8000 --log-level info &
cd /app/web && HOSTNAME=0.0.0.0 PORT=3000 exec node server.js
