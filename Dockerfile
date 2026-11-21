# One image runs everything: the API (with collection every 3 hours and AI analysis when a key is set)
# and the dashboard. Only port 3000 is exposed; the dashboard forwards /api to the API inside.
#   docker build -t azzurro . && docker run -p 3000:3000 --env-file server/.env -v azzurro-data:/data azzurro

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv
COPY --from=web /usr/local/bin/node /usr/local/bin/node
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    REVIEWS_DB=/data/reviews.db DISPLAY=:99 PYTHONUNBUFFERED=1

WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 xvfb \
 && uv sync --frozen --no-dev \
 && uv run playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY server/ ./

# Next.js standalone server, its static files and public assets
COPY --from=web /web/.next/standalone /app/web
COPY --from=web /web/.next/static /app/web/.next/static
COPY --from=web /web/public /app/web/public

COPY docker-start.sh /app/start.sh
VOLUME /data
EXPOSE 3000
CMD ["/app/start.sh"]
