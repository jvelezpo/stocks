import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchedKeywords,
  parsePuppeteerRedditPosts,
  parseRedditSentiment,
} from "./reddit-core.ts";

test("matches configured keywords as whole words without case sensitivity", () => {
  assert.deepEqual(
    findMatchedKeywords("BUY now, hold long-term, and avoid shorts or selling."),
    ["buy", "long"]
  );
});

test("validates and maps posts extracted by Puppeteer", () => {
  const posts = parsePuppeteerRedditPosts([
    {
      redditPostId: "t3_abc123",
      subreddit: "wallstreetbets",
      title: "Time to BUY this dip?",
      author: "u/trader_one",
      postedAt: "2023-11-14T22:13:20.000Z",
      bodyText: "I may stay long for a year.",
      sourceUrl: "/r/wallstreetbets/comments/abc123/time_to_buy/",
      isStickied: false,
    },
  ]);

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.redditPostId, "abc123");
  assert.deepEqual(posts[0]?.matchedKeywords, ["buy", "long"]);
  assert.equal(posts[0]?.author, "trader_one");
  assert.equal(posts[0]?.postedAt, "2023-11-14T22:13:20.000Z");
});

test("rejects an empty Puppeteer extraction", () => {
  assert.throws(
    () => parsePuppeteerRedditPosts([]),
    /did not extract any Reddit posts/
  );
});

test("rejects content from a different subreddit", () => {
  assert.throws(
    () =>
      parsePuppeteerRedditPosts([
        {
          redditPostId: "abc123",
          subreddit: "stocks",
          title: "Buy",
          author: "trader_one",
          postedAt: "2023-11-14T22:13:20.000Z",
          bodyText: "",
          sourceUrl: "/r/stocks/comments/abc123/buy/",
          isStickied: false,
        },
      ]),
    /subreddit was not wallstreetbets/
  );
});

test("rejects invalid rendered post metadata", () => {
  const validPost = {
    redditPostId: "t3_abc123",
    subreddit: "wallstreetbets",
    title: "Buy",
    author: "trader_one",
    postedAt: "2023-11-14T22:13:20.000Z",
    bodyText: "",
    sourceUrl: "/r/wallstreetbets/comments/abc123/buy/",
    isStickied: false,
  };

  assert.throws(
    () =>
      parsePuppeteerRedditPosts([
        { ...validPost, postedAt: "not-a-timestamp" },
      ]),
    /postedAt was invalid/
  );
  assert.throws(
    () =>
      parsePuppeteerRedditPosts([
        {
          ...validPost,
          sourceUrl:
            "https://not-reddit.example/r/wallstreetbets/comments/abc123/buy/",
        },
      ]),
    /outside r\/wallstreetbets/
  );
});

test("parses and validates structured sentiment output", () => {
  assert.deepEqual(
    parseRedditSentiment(`\`\`\`json
      {
        "overall_sentiment": "positive",
        "summary": "Buying interest outweighed bearish discussion.",
        "trends": ["Long positioning increased", "Short ideas were concentrated"]
      }
    \`\`\``),
    {
      overallSentiment: "positive",
      summary: "Buying interest outweighed bearish discussion.",
      trends: ["Long positioning increased", "Short ideas were concentrated"],
    }
  );

  assert.throws(
    () =>
      parseRedditSentiment(
        '{"overall_sentiment":"bullish","summary":"Up","trends":[]}'
      ),
    /positive, negative, or neutral/
  );
});
