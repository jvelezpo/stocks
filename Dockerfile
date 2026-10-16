# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS node-base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=1

# Install the full dependency tree once. The cache mount speeds up lockfile
# changes without adding npm's download cache to an image layer.
FROM node-base AS deps

COPY package.json package-lock.json ./
COPY scripts/install-git-hooks.mjs ./scripts/
RUN --mount=type=cache,id=stocks-npm,target=/root/.npm,sharing=locked \
    npm ci

# ---- Builder: reuse deps and build Next.js ----
FROM deps AS builder

# Build-time dummies: `next build` imports every route, and compose
# `env_file` is runtime-only (plus `.env` is dockerignored), so the real
# secrets are not available here. The libsql client is lazy and never connects
# during the build, but these guards keep any other eager env read from
# failing the build. Real values come from `env_file: .env` at runtime
# (DATABASE_URL=http://db:8080 inside compose, http://localhost:8080 on host).
ARG DATABASE_URL="file::memory:?cache=shared"
ARG DATABASE_AUTH_TOKEN=""
ARG AUTH_SECRET="build-only-dummy-secret-at-least-32-chars"
ENV DATABASE_URL=$DATABASE_URL \
    DATABASE_AUTH_TOKEN=$DATABASE_AUTH_TOKEN \
    AUTH_SECRET=$AUTH_SECRET

COPY . .
RUN --mount=type=cache,id=stocks-next,target=/app/.next/cache,sharing=locked \
    npm run build

# Prune in an intermediate stage so deleted dev dependencies never enter a
# lower layer of the final image.
FROM deps AS prod-deps

RUN npm prune --omit=dev

# ---- Runtime base: stable system Chromium layer ----
FROM node:24-bookworm-slim AS runtime-base

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=5000 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Keep Chromium separate from package.json/package-lock.json so JavaScript
# dependency changes do not invalidate or recompress the browser layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# ---- Runner: production dependencies and application output ----
FROM runtime-base AS runner

COPY --from=prod-deps /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules

# Next.js build output plus everything needed at runtime
# (web server + workers.ts / stock-info.ts / reddit-sentiment.ts via node type stripping).
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts /app/instrumentation.ts /app/middleware.ts /app/workers.ts /app/stock-info.ts /app/reddit-sentiment.ts ./

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'5000')+'/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# scripts/start.mjs runs `next start` and the background workers (SIGTERM-aware).
CMD ["node", "scripts/start.mjs"]
