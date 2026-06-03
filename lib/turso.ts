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
    `)
    .catch((error: unknown) => {
      schemaPromise = null;
      throw error;
    });

  return schemaPromise;
}
