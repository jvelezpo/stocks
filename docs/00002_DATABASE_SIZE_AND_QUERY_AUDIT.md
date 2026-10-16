# Database size and query audit

Assessment date: 2026-10-16

## Scope and conclusion

This audit covers every production SQL path in:

- `lib/database.ts`
- `lib/auth.ts`
- `lib/symbols.ts`
- `lib/stocks.ts`
- `lib/reddit.ts`
- `lib/stock-reddit-analysis.ts`
- `lib/stock-chat.ts`
- `stock-info.ts`
- `reddit-sentiment.ts`
- the pages, API routes, caches, and schedulers that call those modules

The repository does not contain the production database, so production size cannot be established here. The checked-in local sqld volume is used only as a small diagnostic sample.

The main problems are not libSQL itself. They are application behavior:

1. Schema and migration SQL is executed far too often.
2. Several dashboard queries scan and rank whole tables to return one row per symbol.
3. The database stores large LLM/debug payloads that no production read path uses.
4. HFT runs create documents and analysis rows much faster than other data.
5. Reddit dashboard work is repeated for every page request and scans post bodies in JavaScript.
6. Polymarket refreshes call the most expensive stock summary query just to obtain symbol/name pairs.
7. Chat reads can open write transactions, repeat the same session lookup, and poll every two seconds.
8. Most growing tables have no retention policy.

The best first step is a surgical query pass, not a database replacement. Run migrations once, remove repeated full-table work, cache data at its actual freshness cadence, stop writing unused payloads, and add bounded retention. A normalized `current quote + lean samples` design is the later structural improvement.

## Implementation status

Implemented on 2026-10-16:

- added schema version tracking, an explicit `npm run db:migrate` command, and startup migration gates; normal collector children now perform only a schema-version read;
- moved auth tables into the shared migration and reduced authenticated request validation to one joined session/user query;
- replaced per-symbol analysis cooldown reads with one collector-plan query for all requested symbols;
- limited persisted source documents to the 5,000-character preview the product reads;
- disabled repeated prompt text, raw LLM responses, response IDs, usage payloads, and HFT history snapshots by default; `STORE_LLM_DEBUG_PAYLOADS=true` explicitly restores them for diagnostics;
- replaced Polymarket's expensive dashboard-summary dependency with a lightweight active-symbol query, filtered snapshot reads in SQL, and skipped unchanged snapshot rewrites;
- filtered every stock-detail summary CTE/count to the requested symbol;
- cached stock, chart, Reddit sentiment, Reddit mention, manual analysis, and Polymarket reads at their freshness cadence;
- batched Reddit post inserts, stopped unchanged poll-boundary writes, and moved exhausted-queue cleanup to once per collector pass;
- made idle chat session GETs one read batch with no write transaction, changed stock existence checks to `SELECT 1 ... LIMIT 1`, and throttled hot-path cleanup queries.

Not applied automatically:

- production retention/purges and index drops require a backup, production row counts, query plans, and agreed retention values;
- the `stock_current`/lean-sample split and normalized Reddit mention facts require a measured, reversible backfill and cutover;
- a dedicated lightweight chat polling endpoint is still a separate client/API change. Idle polling is now read-only, but a processing poll still returns the session messages.

## Local size and workload sample

Snapshot of `data/iku.db` during this audit:

| Item | Local value | Interpretation |
| --- | ---: | --- |
| Directory disk usage | about 5.5 MiB | Includes sqld metadata, WAL, and wallog; it is not just live rows. |
| Main SQLite file | 487,424 bytes | Small test/development dataset. |
| SQLite used-page bytes | 331,776 bytes | Derived from page and freelist pragmas. |
| SQLite free-page bytes | 155,648 bytes | About 32% of the main file is reusable free pages. |
| sqld `wallog` logical size | 4,952,304 bytes | Larger than the main DB; write churn and log retention must be monitored separately. |
| SQLite WAL logical size | 465,592 bytes | Volatile while sqld is active. |
| Queries recorded by sqld | 11,663 | `stats.json` does not include a trustworthy workload start time, so this is a total, not a rate. |
| Rows read / written | 38,257 / 1,150 | Useful evidence of repeated reads and write churn, but not a production baseline. |

The sample has only 10 quote rows, 6 documents, 2 general analyses, and 4 HFT analyses. Even at that size, the table payload distribution is revealing:

| Table | Rows | Payload bytes | Share of all SQLite payload |
| --- | ---: | ---: | ---: |
| `stock_hft_analyses` | 4 | 44,183 | 36.0% |
| `stock_documents` | 6 | 28,516 | 23.2% |
| `stock_analyses` | 2 | 18,083 | 14.7% |
| `stock_chat_messages` | 16 | 4,616 | 3.8% |
| `stock_history` | 10 | 3,900 | 3.2% |
| `polymarket_market_snapshots` | 11 | 3,493 | 2.8% |

HFT analyses, documents, and general analyses account for about 74% of the sample's payload. This is consistent with the schema: those rows repeat prompts, raw provider responses, page text, and history JSON.

The local sqld slow-query list already records approximately 18–40 ms for Reddit/dashboard queries and 22–40 ms for `latestSummarySql()`, despite the tiny row counts. Production latency should be measured on the server before and after each change.

`PRAGMA auto_vacuum` is `0` in the local DB. Deleting rows makes pages reusable but will not automatically shrink the main file. The read-only inspection connection reports `foreign_keys=0`; because foreign-key enforcement is connection-specific, the application/sqld connection must be checked before relying on `ON DELETE CASCADE` for cleanup.

## Growth model

At the new defaults, one symbol can produce approximately:

- 78 quote samples per 6.5-hour market day at a five-minute cadence;
- 19,656 quote rows per 252-market-day year;
- up to 19.5 HFT analyses and source documents per market day at a 20-minute cooldown;
- roughly 4,914 HFT analysis rows per market year.

In the local sample, a wide `stock_history` row averages about 390 payload bytes and an HFT analysis averages about 11 KiB before index, WAL, and wallog overhead. Naively extrapolating the sample gives roughly 7.7 MiB of quote-table payload and 54 MiB of HFT-analysis payload per symbol/year. This is directional, not a capacity guarantee.

Documents are riskier: `LLM_DOCUMENT_MAX_CHARS` defaults to 50,000. If a near-limit document is stored for every HFT run, the source text alone could approach 1 million characters per symbol/market day. The recent collector improvement stopped storing a document on every quote poll, but every HFT-due run can still store one.

## Complete query execution map

### Schema and configuration

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| `ensureStockSchema()` in `lib/database.ts` | Once per Node process | The web/worker processes cache it, but every scheduled `stock-info.ts` and `reddit-sentiment.ts` child is a new process. All table/index DDL therefore repeats on every collector run. | Run versioned migrations once during deployment/startup. Collector children must not execute DDL. |
| `ensureRedditSchemaMigrations()` | Every `ensureStockSchema()` process initialization | Executes three `PRAGMA table_info` calls, then a JSON-based backfill `UPDATE` and `CREATE INDEX` even after the migration has completed. The backfill grows with both Reddit tables. | Record a schema version and run this backfill exactly once. |
| `ensureAuthSchema()` in `lib/auth.ts` | Every auth helper invocation | It has no memoized promise. `verifySessionToken()` calls it, then calls `getUserById()`, which executes it again. | Move auth schema into the versioned migration; at minimum memoize it per process. |

With the default schedules, short-lived stock and Reddit collectors can initialize the schema roughly 174 times on a normal weekday before retries or manual runs. This is unnecessary DB traffic and lock activity.

### Symbols and collector planning

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| `getCollectorSymbols()` | Every stock collector child | Performs seed-related count work and then an active-symbol read. `ensureStockSchema()` is called through several nested helpers. | Seed during migration. Fetch active symbols directly once. |
| `latestAnalysisRun()` + `latestHftAnalysisRun()` | Two reads per symbol per quote pass | Ten symbols cause 20 cooldown reads every five minutes, before any quote is written. | Fetch all active symbols and both last-analysis timestamps in one collector-plan query, or maintain `next_general_at`/`next_hft_at` in one state row per symbol. |
| Quote inserts | One `INSERT` per successfully scraped symbol | Necessary history write, but each row repeats static name/URL and formatted/JSON data. | Batch the run's writes. Split current display data from lean history samples. Skip an unchanged history insert unless a heartbeat interval has elapsed. |
| `recentStockHistoryRows()` | Each HFT-due symbol | Indexed and bounded to 60 rows; this is appropriate when HFT is actually due. | Keep, but return only fields the HFT prompt needs and do not persist the result again as `history_json`. |

### Dashboard and stock detail reads

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| `latestSummarySql()` | Dashboard cache miss, detail cache miss, Polymarket refresh | Uses window functions over all quote/analysis tables plus four complete `GROUP BY symbol` counts. | Read one `stock_current` row per active symbol. Until then, replace windows with indexed `ORDER BY ... LIMIT 1` lookups and avoid counts that are not displayed. |
| `getStockSummaries()` query 1 | Shared Next cache, currently 30 seconds | Returns latest rows and counts, but scans growing tables to do it. | Cache for 60–300 seconds, matching five-minute collection, and query bounded/current tables. |
| `getStockSummaries()` query 2 | Same cache miss | `ROW_NUMBER()` ranks all history to return 18 points/symbol. | Restrict the input to a recent timestamp window, or maintain a bounded sparkline/current cache. |
| `getStockDetail(symbol)` | Shared 30-second cache and every chat prompt | Its history CTE is symbol-filtered, but analysis/HFT/count CTEs still process all symbols. It also batches five reads, several of which return data not needed by chat. | Apply `symbol = ?` inside every CTE. Add a purpose-specific chat-context read instead of using the entire detail model. |
| `getStockChartHistory()` | Detail-page cache and uncached chart API | Applies `unixepoch()` and window bucketing to the symbol's history. The API route calls it directly with `Cache-Control: no-store`. | Use the existing cached wrapper in the route; cache per symbol/range. Query lean samples and use daily rollups for `1y`. |
| `assertStockViewExists()` | Chat session creation | `COUNT(*)` counts every historical row for a symbol. | Use `SELECT EXISTS(...)` or check `stock_current`/`tracked_symbols`. |

The symbol-detail version of `latestSummarySql()` is particularly misleading: it returns one symbol but still calculates latest analysis and counts across every symbol.

### Reddit reads and writes

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| Poll boundary `SELECT` | Every 15-minute Reddit run | A necessary one-row read. | Keep. |
| Poll boundary UPSERT | Every successful Reddit scrape | Equality satisfies the current `<=` condition, so `updated_at` can be rewritten even when the boundary did not advance. | Update only when timestamp/post ID actually advances. |
| `storeNewPosts()` | For each matching new post | Executes one network DB call per post. Initial baseline may inspect 100 posts. | Use one transaction or `database.batch()` with `INSERT OR IGNORE`. |
| Queue exhaustion `UPDATE` | Every `claimNextAnalysisBatch()` call | Runs before every batch claim, up to several times per collector pass, including when the queue is empty. | Run stale/exhausted cleanup once per collector pass or in periodic maintenance. |
| Queue claim `UPDATE ... RETURNING` | Per analysis batch | Correctly claims work atomically and uses a bounded batch. | Keep; improve the queue index after measuring its plan. |
| Analysis insert + post marking | Per completed/failed batch | Transactional behavior is correct, but the analysis row stores several duplicate/write-only payloads. | Keep the transaction; store only parsed output and required audit metadata. |
| `getRedditSentimentAnalyses()` | Every dashboard request | Not cached. Keyword filtering calls `json_each` per analysis and cannot use a normal keyword index. | Cache 2–5 minutes. Replace fixed keyword JSON filtering with a bit mask or normalized keyword rows. |
| `getRedditStockMentionLists()` | Every dashboard request | Reads every post title/body in the selected timeframe and scans the content repeatedly in JavaScript for every tracked symbol and list type. | Derive `reddit_post_symbol_mentions` at ingestion; query grouped counts/top links. Cache results. |

### Polymarket and manual research

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| `getStockSummaries()` from `polymarket-scheduler.ts` | Immediately and every 15 minutes | Runs both expensive dashboard queries only to pass `{symbol, name}` to Polymarket. | Use one lightweight active-symbol/name query. |
| Snapshot delete + inserts | Every successful symbol refresh | Deletes all current rows and reinserts up to ten per symbol, creating WAL/wallog churn even when content is unchanged. Rows for inactive/deleted symbols can remain. | Store one hashed JSON payload per symbol or UPSERT stable market IDs; skip unchanged writes and clean inactive symbols. |
| Stored snapshot read | Cached for five minutes | Reads every snapshot, then filters allowed symbols and limits groups in JavaScript. | Filter/join active symbols in SQL and limit per symbol, or read one payload row per active symbol. |
| Manual stock/Reddit analysis | Admin-triggered | Latest stock name read and one result insert are appropriately on demand. Stored results are unbounded even though the UI reads five. | Keep on demand; retain a bounded number/age per symbol. |

### Authentication

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| User/OTP reads and writes | Login only | Mostly appropriate, but schema DDL repeats and OTP rows never expire from storage. | Fix migrations; clean consumed/expired OTPs periodically. |
| `verifySessionToken()` | Every authenticated page/API request | Performs a session lookup and a separate user lookup, with repeated auth DDL around them. | Use one indexed `auth_sessions JOIN users` query. Do not cache security state unless a revocation delay is explicitly accepted. |
| Session insert/revoke | Login/logout | Appropriate on demand. Expired/revoked sessions are never removed. | Add bounded session retention and an expiry index if measurements justify it. |
| Admin CRUD | Admin actions only | Some write paths read the row again after mutation. Low frequency and not a priority. | Use `RETURNING` when touching these paths, but optimize hot paths first. |

### Chat

| Query path | Current trigger | Finding | Recommended behavior |
| --- | --- | --- | --- |
| Session list | Opening chat history | Up to 100 sessions, each with correlated message-count and last-message subqueries. | Maintain `message_count` and `last_message_preview` on the session row, or use one grouped join. |
| `getChatSession()` | Opening a session and two-second recovery polling | Always opens a write transaction to check stale state, then reads the same session again and separately reads all messages. Idle reads still commit a write transaction. | Read status/session first. Open a write transaction only if stale recovery is required. Batch the final session/messages read or derive the summary from messages. |
| Processing poll | Every two seconds after reload while status is `processing` | Reloads full session summary and all messages on each poll. | Poll a lightweight `status, updated_at` endpoint every 5–10 seconds, then fetch messages only after the version changes; SSE is optional later. |
| Rate-limit pruning | Every session creation and message claim | Executes a cleanup `DELETE` on hot mutation paths. | Run at most hourly per process or in scheduled maintenance. |
| Empty-session pruning | Every session creation | Cleanup is mixed into a user request. Sessions with messages have no retention at all. | Move all chat retention to bounded maintenance batches. |
| Turn claim | Every chat message | Performs ownership/summary reads, idempotency read, active count, multiple rate-limit writes, a visitor message count, session lock, and insert. | Use a bare ownership row, use the existing rate-limit table for visitor limits, and avoid summary subqueries during mutation. |
| Chat completion/failure | Every response | Updates session and user message, inserts assistant, then queries the session summary again. | Use `UPDATE ... RETURNING` or construct the known response state; avoid the final summary reread. |

## Data stored but not used, or stored much wider than needed

Static production-code search found these columns are written but never selected after normal operation:

- `raw_response_json` in general, HFT, and Reddit analyses;
- `usage_json` and `llm_response_id` in those analysis tables;
- `prompt_path` and the repeated full `prompt_text` in those analysis tables;
- `history_json` in `stock_hft_analyses`;
- `provider`, `model`, `llm_response_id`, and `usage_json` in `stock_chat_messages`;
- `discovered_at` in `reddit_posts`;
- Polymarket `captured_at` in the current UI/query path;
- `provider` in `stock_reddit_analyses`.

`post_ids_json` is not used by runtime reads; it is read by the repeatedly executed migration backfill. `reddit_posts.sentiment_analysis_id` is written but not used by current reads. Keeping both represents the same relationship twice.

Other fields are used, but inefficiently:

- `stock_history` repeats symbol name, source URL, formatted strings, and the complete `stats_json` on every sample.
- Several selected stock stats also appear inside `stats_json`.
- `stock_documents.body_text` can hold 50,000 characters, but every post-capture read uses only `substr(body_text, 1, 5000)`. The full text is used for LLM work before/while the row is written, not read back for that analysis.
- HFT `history_json` duplicates rows that remain in `stock_history` and is never read.
- Parsed LLM results (`recommendation`, decision/confidence, Reddit summary/trends) coexist with full output and raw provider response copies.
- `reddit_posts.subreddit` is constant for this WallStreetBets-only table.
- `polymarket_market_snapshots.stock_name` repeats once per market and can come from symbol/current metadata.

If raw LLM responses are needed for troubleshooting or compliance, place them in a separate debug/audit table with a short TTL and an explicit feature flag. They should not be duplicated indefinitely in hot product tables.

## Index audit

The schema creates overlapping or unused indexes that add write amplification and disk pages.

Candidates to remove after confirming with `EXPLAIN QUERY PLAN` on production-sized data:

- `idx_users_email`: duplicates the `UNIQUE` auto-index on `users.email`.
- `idx_tracked_symbols_symbol`: duplicates the `UNIQUE` auto-index on `tracked_symbols.symbol`.
- `idx_stock_history_symbol_fetched_at`: the `(symbol, fetched_at DESC, id DESC)` index covers its hot prefix and ordering needs.
- `idx_stock_documents_symbol_captured_at`: overlaps the captured-at/id index.
- `idx_stock_analyses_symbol_created_at`: overlaps the created-at/id index.
- `idx_stock_hft_analyses_symbol_created_at`: overlaps the created-at/id index.
- `idx_stock_analyses_recommendation`: no production query filters or orders by recommendation.
- `idx_stock_hft_analyses_decision`: no production query filters or orders by decision.
- `idx_reddit_sentiment_analyses_overall_sentiment`: no production query filters by sentiment.

Likely useful replacements/additions, only after query-plan verification:

- `reddit_sentiment_analyses(status, created_at DESC, id DESC)` for the dashboard.
- `reddit_posts(posted_at DESC, id DESC)` for timeframe reads.
- `stock_chat_sessions(updated_at)` for retention cleanup.
- `auth_otp_codes(expires_at)` and `auth_sessions(expires_at)` if cleanup tables grow enough to justify them.
- A queue-specific Reddit index matching the final claim query, once that query is simplified.

Do not add indexes for small tables merely because a column appears in a predicate. Every index consumes storage and makes writes/logging more expensive.

Keep `idx_stock_chat_messages_session_created_at` while the per-visitor recent-message count remains; that query can use the session/time prefix after resolving a visitor's sessions. Re-evaluate it only if that count is replaced by the rate-limit table.

## Recommended target data model

The lowest-footprint stock design separates current state from history:

```text
tracked_symbols
    1 ─── 1 stock_current             full current display state
    1 ─── N stock_price_samples       lean numeric time series
    1 ─── N stock_daily_rollups       one-year chart history
    1 ─── N stock_analysis_runs       parsed result + essential metadata
    1 ─── N stock_source_previews     bounded 5,000-char preview/hash
```

`stock_current` should be one UPSERTed row per symbol containing name, latest quote, display strings/stats, source URL, last successful collection time, and the latest general/HFT result summary. Dashboard summary becomes a small indexed/current-table read with no window functions.

`stock_price_samples` should contain only the fields actually needed by charts and HFT history: symbol, timestamp, price, numeric change/percent, numeric volume, and any numeric market fields proven useful to the prompt. Formatting belongs in application code. Static name/URL and large JSON do not belong in every sample.

Insert a history sample only when a material value changes or when a heartbeat interval (for example 30 minutes) has elapsed. Always update `stock_current.last_collected_at`, so freshness remains accurate even when no sample is inserted.

For documents, use the scraped body in memory for the LLM call, then store only:

- source URL/title;
- original character count;
- truncation flag;
- content hash;
- the 5,000-character preview already used by the UI/chat.

For Polymarket, one row per symbol with `markets_json`, `captured_at`, and a content hash matches the current read pattern better than delete/reinsert rows. Skip the write when the hash is unchanged.

For Reddit, derive symbol mentions once during ingestion:

```text
reddit_posts
    1 ─── N reddit_post_symbol_mentions(symbol, has_buy, has_sell)
    N ─── 1 reddit_sentiment_analyses
```

This removes repeated body scanning from dashboard requests. Because the keyword set is fixed (`buy`, `sell`, `short`, `long`), an integer bit mask is simpler and smaller than `json_each(keywords_json)` for analysis filtering.

## Retention policy

Retention values are product decisions. The following preserve current visible ranges while bounding storage:

| Data | Suggested retention | Reason |
| --- | --- | --- |
| `stock_current` | One row per tracked symbol | Current dashboard state. |
| Raw lean price samples | 35 days | Covers the one-month chart and HFT recent history. |
| Daily stock rollups | 365 days | Preserves the one-year chart at its existing daily bucket. |
| Full source bodies | Do not persist by default | Product reads only a 5,000-character preview. |
| Source previews | Latest 5–20 per symbol or 30 days | UI reads five; keep a small safety margin. |
| General analyses | 180 days or latest 100/symbol | UI reads five; parsed output is relatively small. |
| HFT analyses | 30 days or latest 500/symbol | High-frequency producer; UI reads five. |
| Raw Reddit bodies | 30–90 days | Needed temporarily for analysis/backfill, not forever. |
| Reddit mention facts/aggregates | 365 days or product-defined all-time | Supports rankings after raw body deletion. |
| Parsed Reddit sentiment summaries | Keep, or 365 days | Small once raw/debug payloads are removed. |
| Manual stock/Reddit analyses | Latest 20/symbol or 180 days | UI reads five. |
| Polymarket cache | Current payload only | No historical query exists. |
| Chat sessions/messages | 180 days after last activity | Current data is unbounded across visitors. Confirm expected chat-history UX first. |
| Chat rate limits | 24 hours | Existing logical policy; move cleanup off hot requests. |
| Consumed/expired OTPs | 1–7 days | No long-term product use. |
| Expired/revoked sessions | 7–30 days after expiry/revoke | No long-term product use. |

Run cleanup in small bounded batches. After the initial purge, use the sqld/libSQL-supported checkpoint/compaction procedure during a maintenance window if physical file shrinkage is required. A normal `DELETE` alone will not shrink this database because auto-vacuum is disabled.

## Implementation plan

### P0: eliminate unnecessary calls without redesigning tables

1. Add a versioned migration command and remove runtime migration/DDL from collector children.
2. Memoize auth schema initialization until it is fully moved to migrations.
3. Replace Polymarket's `getStockSummaries()` dependency with one active symbol/name query.
4. Fetch the stock collector plan for all symbols in one query instead of two cooldown queries per symbol.
5. Filter every stock-detail CTE/count by symbol; replace `COUNT(*)` existence checks with `EXISTS`.
6. Cache Reddit dashboard reads for 2–5 minutes and use the cached chart function in the API route.
7. Make idle chat GETs read-only and stop returning all messages during status polling.
8. Batch Reddit post inserts and update the poll boundary only when it advances.

### P1: stop new waste

1. Stop writing raw LLM response JSON, repeated prompt text, HFT history JSON, and unused chat LLM metadata by default.
2. Store only the source preview/hash needed after analysis.
3. Add retention jobs for auth, chat, analyses, documents, and Reddit raw content.
4. Remove verified redundant indexes.
5. Make Polymarket writes conditional on changed content.

### P2: compact the hot stock path

1. Introduce `stock_current` and lean `stock_price_samples`.
2. Backfill `stock_current` from each symbol's latest history row.
3. Dual-write briefly, validate dashboard parity, then switch reads.
4. Add daily rollups before deleting history older than 35 days.
5. Introduce Reddit symbol-mention facts and backfill the retained window.
6. Purge old/wide data only after a backup and row-count verification.

The P0 work should be completed and measured before the P2 schema split. It provides most of the query reduction with much less migration risk.

## Target steady-state query budget

| Operation | Target DB work |
| --- | --- |
| Quote collector pass | One collector-plan read for all symbols; one batched current/history write; extra reads/writes only for analyses actually due. |
| Reddit pass with no new posts | One boundary read; no boundary write; one bounded queue claim only when LLM processing is enabled. No DDL. |
| Polymarket pass | One active-symbol read; one conditional batch only for changed payloads. |
| Dashboard cache hit | Zero stock/Reddit/Polymarket DB calls. |
| Dashboard cache miss | Current rows plus one bounded recent-sparkline read; cached Reddit aggregates; no full-table counts/windows. |
| Stock detail cache miss | Symbol-bounded indexed reads only. |
| Unauthenticated page | No auth DB call. |
| Authenticated page/API | One joined session/user lookup. |
| Idle chat session GET | One read batch and zero writes. |
| Chat processing poll | One lightweight status/version lookup; full messages only after a change. |

## Production measurement runbook

Before changing or deleting data, capture:

```sql
SELECT name, SUM(pgsize) AS bytes, SUM(payload) AS payload_bytes
FROM dbstat
GROUP BY name
ORDER BY bytes DESC;

SELECT
  page_count * page_size AS allocated_bytes,
  freelist_count * page_size AS reusable_free_bytes
FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count();
```

Capture row counts and oldest/newest timestamps for every growing table. Save sqld's `stats.json`, then compare:

- total query count and rows read/written over a known one-hour window;
- p50/p95 query latency;
- collector queries per pass;
- dashboard queries per cache hit/miss;
- main DB, WAL, and wallog size;
- table/index payload from `dbstat`;
- slow-query and query-plan output for summaries, detail, charts, Reddit, and chat.

Run `EXPLAIN QUERY PLAN` against production-like data, not only the tiny local sample. Verify backups and restore procedures before retention or index drops.

## Acceptance criteria

- Collector processes execute no `CREATE`, `ALTER`, migration backfill, or schema `PRAGMA` during normal runs.
- Stock collector planning is O(1) DB round trips per pass, not O(symbols).
- Polymarket refresh never calls `getStockSummaries()`.
- A cached dashboard request performs zero database calls for stock, Reddit, and Polymarket data.
- Stock-detail queries touch only the requested symbol.
- Idle chat GETs perform no writes; processing polls do not reload all messages.
- No raw LLM response, repeated prompt text, or HFT history snapshot is stored unless an explicit audited debug mode enables it.
- Every growing table has a documented retention rule and bounded cleanup.
- The one-year chart, latest-five document/analysis views, Reddit filters, auth revocation, and chat history continue to work after migration.
- Query count per normal collector cycle falls by at least 70% from a measured production baseline.
- Rows read per dashboard cache miss remain approximately proportional to active symbols and returned chart points, not total historical rows.
- Database, WAL, and wallog growth stabilize within the agreed retention window.

