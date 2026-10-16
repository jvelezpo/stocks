import { createClient, type Client } from "@libsql/client";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

function databaseUrl(): string {
  const value = optionalEnv("DATABASE_URL");

  if (!value) {
    throw new Error("Missing required env var DATABASE_URL.");
  }

  return value;
}

function databaseAuthToken(): string | undefined {
  // Local sqld in docker-compose runs without auth, so the token is optional.
  return optionalEnv("DATABASE_AUTH_TOKEN");
}

// Lazily create the client on first use instead of at import time.
// `next build` imports every route module to collect page data, but the
// builder stage has no `.env` (excluded via .dockerignore) and compose
// `env_file` only applies at runtime. Eagerly reading env here
// made the Docker build fail with "Missing required env var
// DATABASE_URL" even for routes marked `dynamic = "force-dynamic"`.
// URL defaults to the local sqld service in docker-compose
// (http://db:8080, persisted in ./data next to the Dockerfile).
let cachedClient: Client | null = null;

function getClient(): Client {
  cachedClient ??= createClient({
    url: databaseUrl(),
    authToken: databaseAuthToken(),
  });

  return cachedClient;
}

export const database: Client = new Proxy({} as Client, {
  get(_target, prop, _receiver) {
    // Avoid turning the client into a thenable during module inspection.
    if (prop === "then") {
      return undefined;
    }

    const value = Reflect.get(getClient(), prop);

    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});

let schemaPromise: Promise<void> | null = null;
const currentSchemaVersion = 1;

type ColumnDefinition = {
  name: string;
  sql: string;
};

async function tableColumnNames(table: string): Promise<Set<string>> {
  const result = await database.execute(`PRAGMA table_info(${table})`);

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
      await database.execute(`ALTER TABLE ${table} ADD COLUMN ${column.sql}`);
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
  await addMissingColumns("stock_reddit_analyses", [
    {
      name: "market_count",
      sql: "market_count INTEGER NOT NULL DEFAULT 0",
    },
  ]);
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
  await database.execute(`
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
  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_reddit_posts_analysis_queue
      ON reddit_posts (analysis_status, analysis_started_at, id)
  `);
}

async function hasCurrentSchemaVersion(): Promise<boolean> {
  try {
    const result = await database.execute({
      sql: "SELECT 1 FROM app_schema_migrations WHERE version = ? LIMIT 1",
      args: [currentSchemaVersion],
    });

    return result.rows.length > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (message.includes("no such table") && message.includes("app_schema_migrations")) {
      return false;
    }

    throw error;
  }
}

async function applySchemaMigrations(): Promise<void> {
  await database.executeMultiple(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

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

      CREATE INDEX IF NOT EXISTS idx_stock_history_symbol_fetched_id
        ON stock_history (symbol, fetched_at DESC, id DESC);

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

      CREATE INDEX IF NOT EXISTS idx_stock_documents_symbol_captured_id
        ON stock_documents (symbol, captured_at DESC, id DESC);

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

      CREATE INDEX IF NOT EXISTS idx_stock_analyses_symbol_created_id
        ON stock_analyses (symbol, created_at DESC, id DESC);

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

      CREATE INDEX IF NOT EXISTS idx_stock_hft_analyses_symbol_created_id
        ON stock_hft_analyses (symbol, created_at DESC, id DESC);

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

      CREATE TABLE IF NOT EXISTS stock_reddit_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        instruction_text TEXT NOT NULL,
        post_count INTEGER NOT NULL,
        market_count INTEGER NOT NULL DEFAULT 0,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        analysis_text TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stock_reddit_analyses_symbol_created_at
        ON stock_reddit_analyses (symbol, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS polymarket_market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        event_text TEXT NOT NULL,
        market_text TEXT NOT NULL,
        outcomes_json TEXT NOT NULL,
        volume REAL,
        liquidity REAL,
        end_date TEXT NOT NULL,
        source_url TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_polymarket_snapshots_symbol_volume
        ON polymarket_market_snapshots (symbol, volume DESC, id DESC);

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

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'guest')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

      CREATE TABLE IF NOT EXISTS auth_otp_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT NOT NULL DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_email_created
        ON auth_otp_codes (email, created_at DESC);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
        ON auth_sessions (user_id);
    `);
  await ensureRedditSchemaMigrations();
  await database.execute({
    sql: `
      INSERT OR IGNORE INTO app_schema_migrations (version, applied_at)
      VALUES (?, ?)
    `,
    args: [currentSchemaVersion, new Date().toISOString()],
  });
}

export function migrateDatabase(): Promise<void> {
  schemaPromise ??= (async () => {
    if (await hasCurrentSchemaVersion()) {
      return;
    }

    await applySchemaMigrations();
  })().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

export function ensureStockSchema(): Promise<void> {
  return migrateDatabase();
}
