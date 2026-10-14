# ---- Builder: install deps and build Next.js ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runner: production image with Chromium runtime deps for Puppeteer ----
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=5000

# Runtime libraries required by Puppeteer's bundled chrome-headless-shell.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libu2f-udev \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Postinstall downloads the Puppeteer browser into /root/.cache/puppeteer.
RUN npm ci --omit=dev

# Next.js build output plus everything needed at runtime
# (web server + workers.ts / stock-info.ts / reddit-sentiment.ts via node type stripping).
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/scripts ./scripts
COPY next.config.ts instrumentation.ts middleware.ts workers.ts stock-info.ts reddit-sentiment.ts ./

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'5000')+'/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# scripts/start.mjs runs `next start` and the background workers (SIGTERM-aware).
CMD ["node", "scripts/start.mjs"]
