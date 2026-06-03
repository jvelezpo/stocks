# Signal Desk

Signal Desk is a small stock monitoring dashboard built with Next.js, Turso, Puppeteer, and optional OpenRouter-powered analysis.

It collects quote snapshots from Yahoo Finance, stores them in Turso, captures page text for analysis, and presents a dashboard with recent prices, trend charts, analyst-style recommendations, and high-frequency trading signals.

## Features

- Dashboard of tracked symbols with latest price, change, market cap, volume, and capture counts
- Per-symbol detail pages with recent captures, quote stats, documents, and analysis history
- Interactive recent-captures chart with hover tooltips
- Background quote collector that runs during regular US market hours
- Optional OpenRouter LLM analysis for longer-form recommendations and HFT-style signals
- Turso-backed persistence for quote history, captured page documents, and LLM output

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS
- Turso / libSQL
- Puppeteer
- OpenRouter

## Prerequisites

- Node.js compatible with the project `.nvmrc`
- npm
- A Turso database URL and auth token
- Optional: an OpenRouter API key and model

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
SYMBOLS=IONQ,NVDA
STOCK_INFO_RUN_WHEN_MARKET_CLOSED=false

OPENROUTER_API_KEY=sk-key
OPENROUTER_MODEL=openrouter/owl-alpha

TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your_turso_database_auth_token
```

Leave `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` unset if you only want quote capture without LLM analysis.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SYMBOLS` | Yes | Comma-separated symbols or a JSON array, for example `IONQ,NVDA` or `["IONQ","NVDA"]`. |
| `STOCK_INFO_RUN_WHEN_MARKET_CLOSED` | No | Set to `true` to keep the collector running outside regular US market hours. |
| `TURSO_DATABASE_URL` | Yes | Turso/libSQL database URL. |
| `TURSO_AUTH_TOKEN` | Yes | Turso database auth token. |
| `OPENROUTER_API_KEY` | No | Enables LLM analysis when paired with `OPENROUTER_MODEL`. |
| `OPENROUTER_MODEL` | No | OpenRouter model id used for all LLM analysis. |
| `LLM_DOCUMENT_MAX_CHARS` | No | Max captured page text sent to analysis. Defaults to `50000`. |
| `LLM_MAX_OUTPUT_TOKENS` | No | Max analysis output tokens. Defaults to `1200`. |
| `LLM_TIMEOUT_MS` | No | LLM request timeout. Defaults to `60000`. |

## Running

Start the dashboard in development:

```bash
npm run dev
```

Open:

```text
http://localhost:4000
```

Run one manual quote/analysis collection pass:

```bash
npm run stock:info
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

## Data Flow

1. `stock-info.ts` opens Yahoo Finance pages with Puppeteer.
2. It extracts quote data and selected quote stats.
3. It stores quote history and captured page text in Turso.
4. If OpenRouter env vars are present, it runs:
   - `prompts/prompt.md` for general stock analysis
   - `prompts/hft.md` for HFT-style BUY/SELL/HOLD signals
5. The Next.js dashboard reads from Turso and renders the latest summaries and symbol detail pages.

## Useful Commands

```bash
npm run dev          # start Next.js on port 4000
npm run stock:info   # run one collector pass
npm run typecheck    # run TypeScript checks
npm run build        # production build
```

## Notes

- The app creates the required Turso tables automatically on startup.
- HFT output is stored as structured JSON, then rendered as a human-readable decision panel in the UI.
- This project is for monitoring and decision support. It is not financial advice.

