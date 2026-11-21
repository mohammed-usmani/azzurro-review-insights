#!/usr/bin/env bash
# One command: install, load the sample data (first run only), start the API and the dashboard.
#   ./run.sh        then open http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")"

command -v uv >/dev/null || { echo "Needs uv: https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }
command -v npm >/dev/null || { echo "Needs Node.js 20 or newer: https://nodejs.org"; exit 1; }

(
  cd server
  uv sync --quiet
  if [ ! -f data/reviews.db ]; then
    echo "Loading sample data (3,126 reviews collected from Booking.com)..."
    uv run python -m app.db load-sample
  fi
)
(cd web && { [ -d node_modules ] || npm ci --silent; })

trap 'kill 0' EXIT INT TERM
(cd server && uv run uvicorn app.api:app --port 8000 --log-level warning) &
(cd web && npm run dev -- --port 3000) &
echo "Dashboard: http://localhost:3000   API docs: http://localhost:8000/docs   (Ctrl+C stops both)"
wait
