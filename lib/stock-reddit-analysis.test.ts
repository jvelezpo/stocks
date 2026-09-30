import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import test from "node:test";

test("runs per-symbol Reddit analysis and returns only the latest five", async () => {
  const databasePath = `/private/tmp/stock-reddit-analysis-test-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  process.env.OPENCODE_MODEL = "muse-spark-1.3-contributor-free";

  const { ensureStockSchema, turso } = await import("./turso.ts");
  const { getStockRedditAnalyses, runStockRedditAnalysis } = await import(
    "./stock-reddit-analysis.ts"
  );
  const globals = globalThis as Record<string, unknown>;
  const prompts: string[] = [];

  globals.__stockRedditPostsMock = async (symbol: string) => [
    {
      redditPostId: `post-${symbol.toLowerCase()}`,
      subreddit: "wallstreetbets",
      title: `${symbol} discussion`,
      author: "trader",
      postedAt: "2026-09-30T12:00:00.000Z",
      bodyText: `${symbol} has bullish momentum, but valuation remains a risk.`,
      sourceUrl: `https://www.reddit.com/r/wallstreetbets/comments/post${symbol.toLowerCase()}/`,
      isStickied: false,
      matchedKeywords: ["buy"],
    },
  ];
  globals.__opencodeCliMock = async (prompt: string) => {
    prompts.push(prompt);
    return {
      text: `Analysis ${prompts.length}`,
      sessionId: `reddit-analysis-${prompts.length}`,
      usageJson: "{}",
      rawResponseJson: "{}",
    };
  };

  try {
    await ensureStockSchema();
    await turso.execute({
      sql: `
        INSERT INTO stock_history (
          fetched_at,
          symbol,
          name,
          price,
          price_text,
          change,
          change_text,
          change_percent,
          change_percent_text,
          previous_close_text,
          open_text,
          day_range_text,
          market_cap_text,
          volume_text,
          avg_volume_text,
          stats_json,
          source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        "2026-09-30T12:00:00.000Z",
        "TEST",
        "Test Corporation",
        100,
        "$100.00",
        1,
        "+1.00",
        1,
        "+1.00%",
        "$99.00",
        "$99.50",
        "$98.00 - $101.00",
        "$10B",
        "1M",
        "900K",
        "[]",
        "https://finance.yahoo.com/quote/TEST/",
      ],
    });

    const first = await runStockRedditAnalysis("test", "Focus on downside risks.");
    assert.equal(first.instruction, "Focus on downside risks.");
    assert.equal(first.postCount, 1);
    assert.match(prompts[0], /Admin request: Focus on downside risks\./);
    assert.match(prompts[0], /Test Corporation/);

    for (let index = 0; index < 5; index += 1) {
      await runStockRedditAnalysis("TEST", "");
    }

    assert.match(prompts[1], /buy, hold, or sell TEST/i);
    const latest = await getStockRedditAnalyses("TEST");
    assert.equal(latest.length, 5);
    assert.equal(latest[0]?.analysisText, "Analysis 6");
    assert.equal(latest.at(-1)?.analysisText, "Analysis 2");
  } finally {
    delete globals.__stockRedditPostsMock;
    delete globals.__opencodeCliMock;
    delete globals.__stockRedditAnalysisRuns;
    turso.close();
    await unlink(databasePath).catch(() => {});
  }
});
