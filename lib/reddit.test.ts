import assert from "node:assert/strict";
import test from "node:test";

test("ranks tracked stock mentions by post and buy or sell keyword", async () => {
  process.env.TURSO_DATABASE_URL = "file::memory:";
  process.env.TURSO_AUTH_TOKEN = "test-token";

  const { getRedditStockMentionLists } = await import("./reddit.ts");
  const { ensureStockSchema, turso } = await import("./turso.ts");

  try {
    await ensureStockSchema();
    await turso.executeMultiple(`
      INSERT INTO tracked_symbols (symbol, display_name, is_active, created_at, updated_at)
      VALUES
        ('GME', 'GameStop', 1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
        ('NVDA', 'NVIDIA', 1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
        ('TSLA', 'Tesla', 1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z');

      INSERT INTO reddit_posts (
        reddit_post_id, discovered_at, posted_at, subreddit, title, author,
        body_text, source_url, matched_keywords_json
      ) VALUES
        ('one', '2026-09-30T10:00:00.000Z', '2026-09-30T10:00:00.000Z',
          'wallstreetbets', 'Buy NVDA', 'trader', 'NVDA still looks good',
          'https://www.reddit.com/r/wallstreetbets/comments/one/', '["buy"]'),
        ('two', '2026-09-30T11:00:00.000Z', '2026-09-30T11:00:00.000Z',
          'wallstreetbets', '$NVDA update', 'trader', 'Going long',
          'https://www.reddit.com/r/wallstreetbets/comments/two/', '["long"]'),
        ('three', '2026-09-30T12:00:00.000Z', '2026-09-30T12:00:00.000Z',
          'wallstreetbets', 'Sell TSLA', 'trader', '',
          'https://www.reddit.com/r/wallstreetbets/comments/three/', '["sell"]'),
        ('old', '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z',
          'wallstreetbets', 'Buy GME', 'trader', '',
          'https://www.reddit.com/r/wallstreetbets/comments/old/', '["buy"]');
    `);

    const lists = await getRedditStockMentionLists({
      since: "2026-09-30T00:00:00.000Z",
      limit: 5,
    });

    assert.deepEqual(lists.mostDiscussed, [
      {
        symbol: "NVDA",
        name: "NVIDIA",
        postCount: 2,
        posts: [
          {
            title: "$NVDA update",
            url: "https://www.reddit.com/r/wallstreetbets/comments/two/",
          },
          {
            title: "Buy NVDA",
            url: "https://www.reddit.com/r/wallstreetbets/comments/one/",
          },
        ],
      },
      {
        symbol: "TSLA",
        name: "Tesla",
        postCount: 1,
        posts: [
          {
            title: "Sell TSLA",
            url: "https://www.reddit.com/r/wallstreetbets/comments/three/",
          },
        ],
      },
    ]);
    assert.deepEqual(lists.buy, [
      {
        symbol: "NVDA",
        name: "NVIDIA",
        postCount: 1,
        posts: [
          {
            title: "Buy NVDA",
            url: "https://www.reddit.com/r/wallstreetbets/comments/one/",
          },
        ],
      },
    ]);
    assert.deepEqual(lists.sell, [
      {
        symbol: "TSLA",
        name: "Tesla",
        postCount: 1,
        posts: [
          {
            title: "Sell TSLA",
            url: "https://www.reddit.com/r/wallstreetbets/comments/three/",
          },
        ],
      },
    ]);
  } finally {
    turso.close();
  }
});
