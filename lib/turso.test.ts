import assert from "node:assert/strict";
import test from "node:test";

test("migrates earlier Reddit tables to the durable queue schema", async () => {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  process.env.TURSO_AUTH_TOKEN = "test-token";

  const { ensureStockSchema, turso } = await import("./turso.ts");

  try {
    await turso.executeMultiple(`
      CREATE TABLE reddit_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reddit_post_id TEXT NOT NULL UNIQUE,
        discovered_at TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        subreddit TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        body_text TEXT NOT NULL,
        source_url TEXT NOT NULL,
        matched_keywords_json TEXT NOT NULL
      );

      CREATE TABLE reddit_monitor_state (
        id INTEGER PRIMARY KEY,
        last_seen_post_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE reddit_sentiment_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        post_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        overall_sentiment TEXT NOT NULL
      );

      CREATE TABLE stock_reddit_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        instruction_text TEXT NOT NULL,
        post_count INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        analysis_text TEXT NOT NULL
      );

      INSERT INTO reddit_posts (
        reddit_post_id,
        discovered_at,
        posted_at,
        subreddit,
        title,
        author,
        body_text,
        source_url,
        matched_keywords_json
      ) VALUES (
        'already-analyzed',
        '2026-08-20T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z',
        'wallstreetbets',
        'Buy discussion',
        'trader',
        '',
        'https://www.reddit.com/r/wallstreetbets/comments/already-analyzed/',
        '["buy"]'
      );

      INSERT INTO reddit_sentiment_analyses (
        created_at,
        post_ids_json,
        status,
        overall_sentiment
      ) VALUES (
        '2026-08-20T00:01:00.000Z',
        '["already-analyzed"]',
        'completed',
        'positive'
      );
    `);

    await ensureStockSchema();

    const postColumns = await turso.execute("PRAGMA table_info(reddit_posts)");
    const stateColumns = await turso.execute(
      "PRAGMA table_info(reddit_monitor_state)"
    );
    const stockAnalysisColumns = await turso.execute(
      "PRAGMA table_info(stock_reddit_analyses)"
    );
    const polymarketColumns = await turso.execute(
      "PRAGMA table_info(polymarket_market_snapshots)"
    );
    const postColumnNames = new Set(postColumns.rows.map((row) => row.name));
    const stateColumnNames = new Set(stateColumns.rows.map((row) => row.name));
    const stockAnalysisColumnNames = new Set(
      stockAnalysisColumns.rows.map((row) => row.name)
    );
    const migratedPost = await turso.execute({
      sql: `
        SELECT analysis_status, sentiment_analysis_id
        FROM reddit_posts
        WHERE reddit_post_id = ?
      `,
      args: ["already-analyzed"],
    });

    assert.equal(postColumnNames.has("analysis_status"), true);
    assert.equal(postColumnNames.has("analysis_attempt_count"), true);
    assert.equal(postColumnNames.has("analysis_started_at"), true);
    assert.equal(postColumnNames.has("sentiment_analysis_id"), true);
    assert.equal(stateColumnNames.has("last_seen_posted_at"), true);
    assert.equal(stockAnalysisColumnNames.has("market_count"), true);
    assert.equal(polymarketColumns.rows.some((row) => row.name === "outcomes_json"), true);
    assert.equal(migratedPost.rows[0]?.analysis_status, "completed");
    assert.equal(Number(migratedPost.rows[0]?.sentiment_analysis_id), 1);
  } finally {
    turso.close();
  }
});
