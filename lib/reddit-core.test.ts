import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchedKeywords,
  parsePuppeteerRedditPosts,
  parseRedditAtomPosts,
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

test("parses Reddit Atom search results without rendered page selectors", () => {
  const posts = parseRedditAtomPosts(`<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <author><name>/u/trader_one</name></author>
        <category term="wallstreetbets" label="r/wallstreetbets" />
        <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Buy &amp;amp; hold for now.&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt;</content>
        <id>t3_abc123</id>
        <link href="https://www.reddit.com/r/wallstreetbets/comments/abc123/aapl_post/" />
        <published>2026-09-29T20:14:18+00:00</published>
        <title>AAPL &amp; the market</title>
      </entry>
    </feed>`);

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.redditPostId, "abc123");
  assert.equal(posts[0]?.title, "AAPL & the market");
  assert.equal(posts[0]?.bodyText, "Buy & hold for now.");
  assert.equal(posts[0]?.author, "trader_one");
  assert.deepEqual(posts[0]?.matchedKeywords, ["buy"]);
});

test("rejects a Reddit security-block page instead of waiting for a selector", () => {
  assert.throws(
    () =>
      parseRedditAtomPosts(
        "<html><body>You've been blocked by network security.</body></html>"
      ),
    /did not return an Atom feed/
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
