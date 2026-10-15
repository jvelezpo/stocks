# Signal Desk

Signal Desk is a small stock monitoring dashboard built with Next.js, libSQL, Puppeteer, and optional OpenCode-powered analysis.

It collects quote snapshots from Yahoo Finance, stores them in a local libSQL database (sqld in Docker), captures page text for analysis, and presents a dashboard with recent prices, trend charts, analyst-style recommendations, and high-frequency trading signals.

## Features

- Dashboard of tracked symbols with latest price, change, market cap, volume, and capture counts
- Per-symbol detail pages with recent captures, quote stats, documents, and analysis history
- Floating AI chat on each symbol page with persistent per-browser sessions and conversation history
- Interactive recent-captures chart with hover tooltips
- Background quote collector that runs during regular US market hours
- Optional OpenCode analysis for longer-form recommendations and HFT-style signals
- libSQL-backed persistence for quote history, captured page documents, and LLM output
- Admin-only symbol management at `/admin/symbols` (CRUD + active toggle, stored in the `tracked_symbols` table)
- Five-minute r/wallstreetbets monitor for new posts mentioning `buy`, `sell`, `short`, or `long`
- AI-generated Reddit sentiment summaries with dashboard keyword and timeframe filters

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS
- libSQL (sqld in Docker, `./data` volume next to the Dockerfile)
- Puppeteer
- OpenCode (`opencode serve` for Docker, or the CLI for local development)

## Prerequisites

- Node.js compatible with the project `.nvmrc`
- npm
- Docker + `docker compose` (for the bundled libSQL database and production run)
- Optional: OpenCode installed on the host (defaults to `muse-spark-1.3-contributor-free`)

## Setup

Install dependencies:

```bash
npm install
```

Create your local env file:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Optional legacy seed: on first run an empty tracked_symbols table is seeded
# from SYMBOLS. Afterwards manage symbols at /admin/symbols (admin only).
SYMBOLS=IONQ,NVDA
STOCK_INFO_RUN_WHEN_MARKET_CLOSED=false

# Docker connects to the host OpenCode server; local development uses the CLI.
OPENCODE_MODEL=muse-spark-1.3-contributor-free
# OPENCODE_CLI_PATH=opencode
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=replace-with-a-random-secret

# Local libSQL in Docker (default, persisted in ./data).
# Host-side tools use localhost; compose overrides to http://db:8080 in the app.
DATABASE_URL=http://localhost:8080
# DATABASE_AUTH_TOKEN=  # sqld runs without auth by default
```

LLM analysis uses the OpenCode service in Compose. The service runs the official OpenCode image and keeps its authentication in a persistent Docker volume. Set `OPENCODE_DISABLED=true` or `OPENCODE_MODEL=none` to skip AI analysis; quote capture and matching Reddit post collection still run. `OPENCODE_MODEL` defaults to `muse-spark-1.3-contributor-free` (Muse Spark 1.3 Free).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SYMBOLS` | No | Legacy seed only: when the `tracked_symbols` table is empty it is seeded once from this comma-separated list or JSON array. Afterwards symbols are managed in the DB at `/admin/symbols` (admin only). |
| `STOCK_INFO_RUN_WHEN_MARKET_CLOSED` | No | Set to `true` to keep the collector running outside regular US market hours. |
| `RUN_SCHEDULERS_IN_WEB_PROCESS` | No | Compatibility escape hatch. Set to `true` only for a single-instance deployment that cannot run the dedicated worker. Defaults to `false`. |
| `DATABASE_URL` | Yes | libSQL database URL. Default `http://localhost:8080` (local sqld in Docker, persisted in `./data`). Compose overrides to `http://db:8080` in the app. |
| `DATABASE_AUTH_TOKEN` | No | Authentication token for the database when configured. Local sqld runs without auth by default. |
| `OPENCODE_MODEL` | No | OpenCode model id used for all LLM analysis. Defaults to `muse-spark-1.3-contributor-free` (Muse Spark 1.3 Free). Use `provider/model` format or a short id (short ids are prefixed with `opencode/`). |
| `OPENCODE_CLI_PATH` | No | Path to the OpenCode CLI binary for local development. Defaults to `opencode`. |
| `OPENCODE_SERVER_URL` | No | OpenCode server URL. Compose sets this to `http://opencode:4096`; local development can leave it unset to use the CLI. |
| `OPENCODE_SERVER_USERNAME` | No | Username for the OpenCode service. Defaults to `opencode`. |
| `OPENCODE_SERVER_PASSWORD` | In Docker | Password shared by the app and OpenCode service. |
| `OPENCODE_DISABLED` | No | Set to `true` (or `OPENCODE_MODEL=none`) to skip LLM analysis. |
| `LLM_DOCUMENT_MAX_CHARS` | No | Max captured page text sent to analysis. Defaults to `50000`. |
| `LLM_MAX_OUTPUT_TOKENS` | No | Max AI response tokens. Defaults to `600`. |
| `LLM_TIMEOUT_MS` | No | LLM request timeout. Defaults to `60000`. |
| `STOCK_CHAT_RATE_LIMIT_SALT` | No | Secret used to hash network rate-limit keys for stock chat. Defaults to the database auth token. |
| `STOCK_CHAT_TRUST_PROXY_HEADERS` | No | Set to `true` only when a trusted edge proxy overwrites forwarded client-IP headers; enables per-network chat limits. |
| `REDDIT_TIMEOUT_MS` | No | Puppeteer page navigation and rendered-content timeout for Reddit monitoring. Defaults to `60000`. |
| `POLYMARKET_TIMEOUT_MS` | No | Polymarket request timeout. Defaults to `60000`. |

## Docker

Run the dashboard plus background workers with a single command in the background:

```bash
cp .env.example .env  # fill in AUTH_SECRET, ADMIN_EMAILS, RESEND_*, OPENCODE_SERVER_PASSWORD
docker compose up -d --build
```

Compose starts the `opencode` service with the official OpenCode image. Its authentication is stored in a dedicated persistent Docker volume. Authenticate it once with `docker compose exec opencode opencode auth login` and follow the prompts. This container uses its own OpenCode login and does not read your host OpenCode files.

Open `http://localhost:5000`. Other commands:

```bash
docker compose logs -f        # follow web + worker logs
docker compose ps             # status / health
docker compose down           # stop and remove the containers (data stays in ./data)
docker compose down -v        # danger: also removes named volumes (bind-mounted ./data is kept)
```

Notes:

- `docker compose up` starts two services: `db` (sqld, ports 8080/5001, data in `./data` next to the Dockerfile) and `app`.
- Tables are created automatically on startup; a fresh `./data` starts empty (seed `SYMBOLS` once via the `tracked_symbols` table or `/admin/symbols`).

- The image runs `node scripts/start.mjs` (Next.js on `PORT`, default `5000`, plus the workers).
- Puppeteer runs with `--no-sandbox`; compose sets `shm_size: 1gb` so headless Chrome has enough shared memory.
- The Docker app connects to the Compose `opencode` service for LLM analysis. Local development uses `OPENCODE_CLI_PATH` when `OPENCODE_SERVER_URL` is unset.

## Running

Start the dashboard and hot-reloading workers together:

```bash
npm run dev
```

Run only one side when debugging it independently:

```bash
npm run dev:web
npm run workers:dev
```

Open:

```text
http://localhost:5000
```

Run one manual quote/analysis collection pass:

```bash
npm run stock:info
```

Run one manual Reddit collection and sentiment pass:

```bash
npm run reddit:sentiment
```

Build for production:

```bash
npm run build
```

Start the production API and background workers after building:

```bash
npm start
```

## Background Collection

`npm run workers:start` runs the stock-info scheduler outside the Next.js web process. The scheduler:

- runs `stock-info.ts` every 60 seconds
- only runs during regular US market hours by default
- waits for the next market open when the market is closed
- skips overlapping runs if the previous collection is still active

Set `STOCK_INFO_RUN_WHEN_MARKET_CLOSED=true` to disable the market-hours gate.

The worker also starts independent Reddit and Polymarket schedulers. Reddit runs immediately and every five minutes, operates outside market hours, and skips overlapping runs. Each run opens r/wallstreetbets with Puppeteer, validates rendered posts back to the prior poll boundary, and deduplicates matching posts by their stable Reddit ID. Polymarket refreshes every five minutes and stores snapshots in libSQL so dashboard requests never wait on Polymarket's API.

For compatibility, `RUN_SCHEDULERS_IN_WEB_PROCESS=true` restores the old single-process behavior. Do not enable it when multiple web replicas are running.

## Data Flow

1. `stock-info.ts` loads the active symbols from the `tracked_symbols` table (managed at `/admin/symbols`), opens Yahoo Finance pages with Puppeteer.
2. It extracts quote data and selected quote stats.
3. It stores quote history and captured page text in libSQL.
4. Unless disabled (`OPENCODE_DISABLED=true` or `OPENCODE_MODEL=none`), it runs analysis through OpenCode:
   - `prompts/prompt.md` for general stock analysis
   - `prompts/hft.md` for HFT-style BUY/SELL/HOLD signals
5. The Next.js dashboard reads from libSQL and renders the latest summaries and symbol detail pages.

Polymarket discovery runs in the worker. It stores current matching markets in `polymarket_market_snapshots`; the dashboard reads these snapshots instead of calling Polymarket during navigation.

For Reddit sentiment:

1. `reddit-sentiment.ts` opens r/wallstreetbets with Puppeteer and extracts the newest rendered posts.
2. It validates the extracted content and stores previously unseen posts whose title or body contains a monitored keyword as a whole word.
3. New matching posts enter a durable analysis queue. Stale work is reclaimed and failed AI calls are retried up to three times.
4. Pending posts are sent to the configured OpenCode model in batches and the structured sentiment result is stored separately.
5. The dashboard renders completed batch-wide summaries and filters them by contained keyword or analysis timeframe.

If OpenCode is disabled, matching Reddit posts are still stored but no sentiment summary is generated for that run.

For stock chat, open any `/stocks/{symbol}` page and use the floating chat button. Sessions and messages are stored in libSQL and scoped to an anonymous, HttpOnly browser cookie. Each AI turn receives the latest stored data represented by that symbol view, plus the completed conversation history. The composer stays locked while a reply is in progress.

## Useful Commands

```bash
npm run dev          # start Next.js plus hot-reloading workers
npm run dev:web      # start only Next.js on port 5000
npm run workers:dev  # start only workers with hot reload
npm run workers:start # run quote, Reddit, and Polymarket schedulers
npm run stock:info   # run one collector pass
npm run reddit:sentiment # run one Reddit sentiment pass
npm test             # run Reddit validation unit tests
npm run typecheck    # run TypeScript checks
npm run build        # production build
npm start            # run the production API plus workers
```

## Notes

- The app creates the required libSQL tables automatically on startup.
- HFT output is stored as structured JSON, then rendered as a human-readable decision panel in the UI.
- The collection timers require one long-lived worker process. Do not run more than one worker against the same deployment.
- Reddit monitoring reads public pages through Puppeteer; no Reddit client ID, client secret, or API user-agent configuration is required.
- Stock chat history is browser-specific until the application adds signed-in user accounts; clearing its anonymous visitor cookie starts a new history scope.
- This project is for monitoring and decision support. It is not financial advice.
