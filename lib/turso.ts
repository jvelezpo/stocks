import { createClient } from "@libsql/client";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var ${name}.`);
  }

  return value;
}

export const turso = createClient({
  url: requiredEnv("TURSO_DATABASE_URL"),
  authToken: requiredEnv("TURSO_AUTH_TOKEN"),
});

let schemaPromise: Promise<void> | null = null;

type ColumnDefinition = {
  name: string;
  sql: string;
};

async function tableColumnNames(table: string): Promise<Set<string>> {
  const result = await turso.execute(`PRAGMA table_info(${table})`);

  return new Set(
    result.rows.flatMap((row) =>
      typeof row.name === "string" ? [row.name] : []
    )
  );
}

async function addMissingColumns(
  table: string,
  columns: ColumnDefinition[]
): Promise<void> {
  const existingColumns = await tableColumnNames(table);

  for (const column of columns) {
    if (existingColumns.has(column.name)) {
      continue;
    }

    try {
      await turso.execute(`ALTER TABLE ${table} ADD COLUMN ${column.sql}`);
      existingColumns.add(column.name);
    } catch (error: unknown) {
      const currentColumns = await tableColumnNames(table);

      if (!currentColumns.has(column.name)) {
        throw error;
      }

      existingColumns.add(column.name);
    }
  }
}

async function ensureRedditSchemaMigrations(): Promise<void> {
  await addMissingColumns("reddit_posts", [
    {
      name: "analysis_status",
      sql: "analysis_status TEXT NOT NULL DEFAULT 'pending'",
    },
    {
      name: "analysis_attempt_count",
      sql: "analysis_attempt_count INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "analysis_started_at",
      sql: "analysis_started_at TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "sentiment_analysis_id",
      sql: "sentiment_analysis_id INTEGER NOT NULL DEFAULT 0",
    },
  ]);
  await addMissingColumns("reddit_monitor_state", [
    {
      name: "last_seen_posted_at",
      sql: "last_seen_posted_at TEXT NOT NULL DEFAULT ''",
    },
  ]);
  await turso.execute(`
    UPDATE reddit_posts
    SET
      analysis_status = 'completed',
      sentiment_analysis_id = (
        SELECT analysis.id
        FROM
          reddit_sentiment_analyses AS analysis,
          json_each(
            CASE
              WHEN json_valid(analysis.post_ids_json) THEN analysis.post_ids_json
              ELSE '[]'
            END
          ) AS analyzed_post
        WHERE analysis.status = 'completed'
          AND CAST(analyzed_post.value AS TEXT) = reddit_posts.reddit_post_id
        ORDER BY analysis.created_at DESC, analysis.id DESC
        LIMIT 1
      )
    WHERE analysis_status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM
          reddit_sentiment_analyses AS analysis,
          json_each(
            CASE
              WHEN json_valid(analysis.post_ids_json) THEN analysis.post_ids_json
              ELSE '[]'
            END
          ) AS analyzed_post
        WHERE analysis.status = 'completed'
          AND CAST(analyzed_post.value AS TEXT) = reddit_posts.reddit_post_id
      )
  `);
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_reddit_posts_analysis_queue
      ON reddit_posts (analysis_status, analysis_started_at, id)
  `);
}

export function ensureStockSchema(): Promise<void> {
  schemaPromise ??= turso
    .executeMultiple(`
      CREATE TABLE IF NOT EXISTS stock_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fetched_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        price_text TEXT NOT NULL,
        change REAL,
        change_text TEXT NOT NULL,
        change_percent REAL,
        change_percent_text TEXT NOT NULL,
        previous_close_text TEXT NOT NULL,
        open_text TEXT NOT NULL,
        day_range_text TEXT NOT NULL,
        market_cap_text TEXT NOT NULL,
        volume_text TEXT NOT NULL,
        avg_volume_text TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        source_url TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stock_history_symbol_fetched_at
        ON stock_history (symbol, fetched_at);

      CREATE TABLE IF NOT EXISTS stock_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_history_id INTEGER NOT NULL,
        captured_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        body_text TEXT NOT NULL,
        body_char_count INTEGER NOT NULL,
        was_truncated INTEGER NOT NULL,
        FOREIGN KEY (stock_history_id) REFERENCES stock_history(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_stock_documents_symbol_captured_at
        ON stock_documents (symbol, captured_at);

      CREATE TABLE IF NOT EXISTS stock_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_history_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        prompt_path TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        input_char_count INTEGER NOT NULL,
        output_char_count INTEGER NOT NULL,
        analysis_text TEXT NOT NULL,
        error_text TEXT NOT NULL,
        llm_response_id TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        raw_response_json TEXT NOT NULL,
        FOREIGN KEY (stock_history_id) REFERENCES stock_history(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES stock_documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_stock_analyses_symbol_created_at
        ON stock_analyses (symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_stock_analyses_recommendation
        ON stock_analyses (recommendation);

      CREATE TABLE IF NOT EXISTS stock_hft_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_history_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        decision TEXT NOT NULL,
        confidence REAL,
        market_regime TEXT NOT NULL,
        prompt_path TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        input_char_count INTEGER NOT NULL,
        output_char_count INTEGER NOT NULL,
        analysis_text TEXT NOT NULL,
        error_text TEXT NOT NULL,
        llm_response_id TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        raw_response_json TEXT NOT NULL,
        history_json TEXT NOT NULL,
        FOREIGN KEY (stock_history_id) REFERENCES stock_history(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES stock_documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_stock_hft_analyses_symbol_created_at
        ON stock_hft_analyses (symbol, created_at);

      CREATE INDEX IF NOT EXISTS idx_stock_hft_analyses_decision
        ON stock_hft_analyses (decision);

      CREATE TABLE IF NOT EXISTS reddit_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reddit_post_id TEXT NOT NULL UNIQUE,
        discovered_at TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        subreddit TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        body_text TEXT NOT NULL,
        source_url TEXT NOT NULL,
        matched_keywords_json TEXT NOT NULL,
        analysis_status TEXT NOT NULL DEFAULT 'pending',
        analysis_attempt_count INTEGER NOT NULL DEFAULT 0,
        analysis_started_at TEXT NOT NULL DEFAULT '',
        sentiment_analysis_id INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_reddit_posts_posted_at
        ON reddit_posts (posted_at);

      CREATE TABLE IF NOT EXISTS reddit_monitor_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_seen_post_id TEXT NOT NULL,
        last_seen_posted_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reddit_sentiment_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        post_count INTEGER NOT NULL,
        post_ids_json TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        overall_sentiment TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        trends_json TEXT NOT NULL,
        prompt_path TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        input_char_count INTEGER NOT NULL,
        output_char_count INTEGER NOT NULL,
        analysis_text TEXT NOT NULL,
        error_text TEXT NOT NULL,
        llm_response_id TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        raw_response_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reddit_sentiment_analyses_created_at
        ON reddit_sentiment_analyses (created_at);

      CREATE INDEX IF NOT EXISTS idx_reddit_sentiment_analyses_overall_sentiment
        ON reddit_sentiment_analyses (overall_sentiment);

      CREATE TABLE IF NOT EXISTS stock_chat_sessions (
        id TEXT PRIMARY KEY,
        visitor_hash TEXT NOT NULL,
        symbol TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('idle', 'processing')),
        active_turn_id TEXT NOT NULL DEFAULT '',
        processing_started_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stock_chat_sessions_visitor_symbol_updated_at
        ON stock_chat_sessions (visitor_hash, symbol, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_stock_chat_sessions_status_started_at
        ON stock_chat_sessions (status, processing_started_at);

      CREATE TABLE IF NOT EXISTS stock_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        error_text TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        llm_response_id TEXT NOT NULL DEFAULT '',
        usage_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES stock_chat_sessions(id) ON DELETE CASCADE,
        UNIQUE (session_id, turn_id, role)
      );

      CREATE INDEX IF NOT EXISTS idx_stock_chat_messages_session_id
        ON stock_chat_messages (session_id, id);

      CREATE INDEX IF NOT EXISTS idx_stock_chat_messages_session_created_at
        ON stock_chat_messages (session_id, created_at);

      CREATE TABLE IF NOT EXISTS stock_chat_rate_limits (
        scope_key TEXT PRIMARY KEY,
        window_started_at TEXT NOT NULL,
        request_count INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stock_chat_rate_limits_window_started_at
        ON stock_chat_rate_limits (window_started_at);

      CREATE TABLE IF NOT EXISTS tracked_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tracked_symbols_symbol
        ON tracked_symbols (symbol);

      CREATE INDEX IF NOT EXISTS idx_tracked_symbols_is_active
        ON tracked_symbols (is_active);
    `)
    .then(ensureRedditSchemaMigrations)
    .catch((error: unknown) => {
      schemaPromise = null;
      throw error;
    });

  return schemaPromise;
}
