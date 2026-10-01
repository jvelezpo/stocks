# Signal Desk

Signal Desk is a small stock monitoring dashboard built with Next.js, Turso, Puppeteer, and optional Opencode CLI-powered analysis.

It collects quote snapshots from Yahoo Finance, stores them in Turso, captures page text for analysis, and presents a dashboard with recent prices, trend charts, analyst-style recommendations, and high-frequency trading signals.

## Features

- Dashboard of tracked symbols with latest price, change, market cap, volume, and capture counts
- Per-symbol detail pages with recent captures, quote stats, documents, and analysis history
- Floating AI chat on each symbol page with persistent per-browser sessions and conversation history
- Interactive recent-captures chart with hover tooltips
- Background quote collector that runs during regular US market hours
- Optional Opencode CLI analysis for longer-form recommendations and HFT-style signals
- Turso-backed persistence for quote history, captured page documents, and LLM output
- Admin-only symbol management at `/admin/symbols` (CRUD + active toggle, stored in the `tracked_symbols` table)
- Five-minute r/wallstreetbets monitor for new posts mentioning `buy`, `sell`, `short`, or `long`
- AI-generated Reddit sentiment summaries with dashboard keyword and timeframe filters

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS
- Turso / libSQL
- Puppeteer
- Opencode CLI (`opencode run` with `muse-spark-1.3-contributor-free`)

## Prerequisites

- Node.js compatible with the project `.nvmrc`
- npm
- A Turso database URL and auth token
- Optional: the Opencode CLI installed and reachable as `opencode` (defaults to `muse-spark-1.3-contributor-free`)

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

# Analysis runs through the local `opencode` CLI; no API key is needed.
OPENCODE_MODEL=muse-spark-1.3-contributor-free
# OPENCODE_CLI_PATH=opencode

TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your_turso_database_auth_token
```

LLM analysis runs through the local Opencode CLI (`opencode run --format json`). No API key is needed; the Zen free tier works from within OpenCode, which is why direct Responses API calls were replaced. Set `OPENCODE_DISABLED=true` or `OPENCODE_MODEL=none` to skip AI analysis; quote capture and matching Reddit post collection still run. `OPENCODE_MODEL` defaults to `muse-spark-1.3-contributor-free` (Muse Spark 1.3 Free).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SYMBOLS` | No | Legacy seed only: when the `tracked_symbols` table is empty it is seeded once from this comma-separated list or JSON array. Afterwards symbols are managed in the DB at `/admin/symbols` (admin only). |
| `STOCK_INFO_RUN_WHEN_MARKET_CLOSED` | No | Set to `true` to keep the collector running outside regular US market hours. |
| `TURSO_DATABASE_URL` | Yes | Turso/libSQL database URL. |
| `TURSO_AUTH_TOKEN` | Yes | Turso database auth token. |
| `OPENCODE_MODEL` | No | Opencode model id used for all LLM analysis via the local CLI. Defaults to `muse-spark-1.3-contributor-free` (Muse Spark 1.3 Free). Use `opencode/provider-model` format or a short id (short ids are prefixed with `opencode/`). |
| `OPENCODE_CLI_PATH` | No | Path to the Opencode CLI binary. Defaults to `opencode`. |
| `OPENCODE_DISABLED` | No | Set to `true` (or `OPENCODE_MODEL=none`) to skip LLM analysis. |
| `LLM_DOCUMENT_MAX_CHARS` | No | Max captured page text sent to analysis. Defaults to `50000`. |
| `LLM_MAX_OUTPUT_TOKENS` | No | Max AI response tokens. Defaults to `600`. |
| `LLM_TIMEOUT_MS` | No | LLM request timeout. Defaults to `60000`. |
| `STOCK_CHAT_RATE_LIMIT_SALT` | No | Secret used to hash network rate-limit keys for stock chat. Defaults to the Turso auth token. |
| `STOCK_CHAT_TRUST_PROXY_HEADERS` | No | Set to `true` only when a trusted edge proxy overwrites forwarded client-IP headers; enables per-network chat limits. |
| `REDDIT_TIMEOUT_MS` | No | Puppeteer page navigation and rendered-content timeout for Reddit monitoring. Defaults to `60000`. |

## Running

Start the dashboard in development:

```bash
npm run dev
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

Start the production dashboard after building:

```bash
npm run dashboard:start
```

## Background Collection

When the Next.js app starts in the Node.js runtime, `instrumentation.ts` starts the stock-info scheduler. The scheduler:

- runs `stock-info.ts` every 60 seconds
- only runs during regular US market hours by default
- waits for the next market open when the market is closed
- skips overlapping runs if the previous collection is still active

Set `STOCK_INFO_RUN_WHEN_MARKET_CLOSED=true` to disable the market-hours gate.

The same startup hook starts an independent Reddit scheduler. It runs immediately and every five minutes, operates outside market hours, and skips overlapping runs. Each run opens r/wallstreetbets with Puppeteer, validates rendered posts back to the prior poll boundary, and deduplicates matching posts by their stable Reddit ID.

## Data Flow

1. `stock-info.ts` loads the active symbols from the `tracked_symbols` table (managed at `/admin/symbols`), opens Yahoo Finance pages with Puppeteer.
2. It extracts quote data and selected quote stats.
3. It stores quote history and captured page text in Turso.
4. Unless disabled (`OPENCODE_DISABLED=true` or `OPENCODE_MODEL=none`), it runs via the local Opencode CLI:
   - `prompts/prompt.md` for general stock analysis
   - `prompts/hft.md` for HFT-style BUY/SELL/HOLD signals
5. The Next.js dashboard reads from Turso and renders the latest summaries and symbol detail pages.

For Reddit sentiment:

1. `reddit-sentiment.ts` opens r/wallstreetbets with Puppeteer and extracts the newest rendered posts.
2. It validates the extracted content and stores previously unseen posts whose title or body contains a monitored keyword as a whole word.
3. New matching posts enter a durable analysis queue. Stale work is reclaimed and failed AI calls are retried up to three times.
4. Pending posts are sent to the configured Opencode CLI model in batches and the structured sentiment result is stored separately.
5. The dashboard renders completed batch-wide summaries and filters them by contained keyword or analysis timeframe.

If the Opencode CLI is disabled, matching Reddit posts are still stored but no sentiment summary is generated for that run.

For stock chat, open any `/stocks/{symbol}` page and use the floating chat button. Sessions and messages are stored in Turso and scoped to an anonymous, HttpOnly browser cookie. Each AI turn receives the latest stored data represented by that symbol view, plus the completed conversation history. The composer stays locked while a reply is in progress.

## Useful Commands

```bash
npm run dev          # start Next.js on port 5000
npm run stock:info   # run one collector pass
npm run reddit:sentiment # run one Reddit sentiment pass
npm test             # run Reddit validation unit tests
npm run typecheck    # run TypeScript checks
npm run build        # production build
```

## Notes

- The app creates the required Turso tables automatically on startup.
- HFT output is stored as structured JSON, then rendered as a human-readable decision panel in the UI.
- The five-minute timers require a long-lived app process. For serverless or multi-replica deployments, run the Reddit collector from one dedicated worker or external scheduler instead.
- Reddit monitoring reads public pages through Puppeteer; no Reddit client ID, client secret, or API user-agent configuration is required.
- Stock chat history is browser-specific until the application adds signed-in user accounts; clearing its anonymous visitor cookie starts a new history scope.
- This project is for monitoring and decision support. It is not financial advice.
