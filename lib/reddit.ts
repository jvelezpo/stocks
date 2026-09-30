import {
  REDDIT_KEYWORDS,
  type RedditKeyword,
  type RedditSentimentResult,
} from "./reddit-core.ts";
import { ensureStockSchema, turso } from "./turso.ts";

const defaultLimit = 25;
const maximumLimit = 100;
const redditKeywords = new Set<string>(REDDIT_KEYWORDS);

export type RedditSentimentAnalysis = {
  id: number;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  postCount: number;
  keywords: RedditKeyword[];
  model: string;
  overallSentiment: RedditSentimentResult["overallSentiment"];
  summary: string;
  trends: string[];
};

export type RedditSentimentAnalysisFilters = {
  keyword?: RedditKeyword;
  since?: string;
  limit?: number;
};

export type RedditStockMention = {
  symbol: string;
  name: string;
  postCount: number;
  posts: RedditStockMentionPost[];
};

export type RedditStockMentionPost = {
  title: string;
  url: string;
};

export type RedditStockMentionLists = {
  mostDiscussed: RedditStockMention[];
  buy: RedditStockMention[];
  sell: RedditStockMention[];
};

export type RedditStockMentionFilters = {
  since?: string;
  limit?: number;
};

type RedditSentimentAnalysisRow = {
  id: number;
  created_at: string;
  period_start: string;
  period_end: string;
  post_count: number;
  keywords_json: string;
  model: string;
  overall_sentiment: string;
  summary_text: string;
  trends_json: string;
};

type RedditPostMentionRow = {
  title: string;
  body_text: string;
  source_url: string;
  matched_keywords_json: string;
};

type TrackedSymbolRow = {
  symbol: string;
  display_name: string;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) =>
      typeof item === "string" && item.trim() ? [item.trim()] : []
    );
  } catch {
    return [];
  }
}

function parseKeywords(value: string): RedditKeyword[] {
  return parseStringArray(value).filter(
    (keyword): keyword is RedditKeyword => redditKeywords.has(keyword)
  );
}

function parseOverallSentiment(
  value: string
): RedditSentimentResult["overallSentiment"] {
  return value === "positive" || value === "negative" || value === "neutral"
    ? value
    : "neutral";
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultLimit;
  }

  return Math.min(Math.max(Math.trunc(value), 1), maximumLimit);
}

function stockMentionPattern(symbol: string): RegExp {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:\\$|(?<![A-Z0-9]))${escaped}(?![A-Z0-9])`, "i");
}

function rankStockMentions(
  posts: RedditPostMentionRow[],
  symbols: TrackedSymbolRow[],
  keyword: RedditKeyword | undefined,
  limit: number
): RedditStockMention[] {
  const postsBySymbol = new Map<string, RedditStockMentionPost[]>();

  for (const post of posts) {
    const keywords = parseKeywords(post.matched_keywords_json);

    if (keyword && !keywords.includes(keyword)) {
      continue;
    }

    const text = `${post.title}\n${post.body_text}`;

    for (const stock of symbols) {
      if (stockMentionPattern(stock.symbol).test(text)) {
        const matchingPosts = postsBySymbol.get(stock.symbol) ?? [];
        matchingPosts.push({ title: post.title, url: post.source_url });
        postsBySymbol.set(stock.symbol, matchingPosts);
      }
    }
  }

  return symbols
    .flatMap((stock) => {
      const posts = postsBySymbol.get(stock.symbol) ?? [];

      return posts.length > 0
        ? [{ symbol: stock.symbol, name: stock.display_name, postCount: posts.length, posts }]
        : [];
    })
    .sort(
      (left, right) =>
        right.postCount - left.postCount || left.symbol.localeCompare(right.symbol)
    )
    .slice(0, limit);
}

function mapAnalysis(row: RedditSentimentAnalysisRow): RedditSentimentAnalysis {
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    postCount: Number(row.post_count),
    keywords: parseKeywords(row.keywords_json),
    model: row.model,
    overallSentiment: parseOverallSentiment(row.overall_sentiment),
    summary: row.summary_text,
    trends: parseStringArray(row.trends_json),
  };
}

export async function getRedditSentimentAnalyses(
  filters: RedditSentimentAnalysisFilters = {}
): Promise<RedditSentimentAnalysis[]> {
  await ensureStockSchema();

  const whereClauses = ["analysis.status = 'completed'"];
  const args: Array<string | number> = [];

  if (filters.keyword) {
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM json_each(
          CASE
            WHEN json_valid(analysis.keywords_json) THEN analysis.keywords_json
            ELSE '[]'
          END
        ) AS keyword
        WHERE CAST(keyword.value AS TEXT) = ?
      )
    `);
    args.push(filters.keyword);
  }

  const since = filters.since?.trim();

  if (since) {
    whereClauses.push("analysis.created_at >= ?");
    args.push(since);
  }

  args.push(boundedLimit(filters.limit));

  const result = await turso.execute({
    sql: `
      SELECT
        id,
        created_at,
        period_start,
        period_end,
        post_count,
        keywords_json,
        model,
        overall_sentiment,
        summary_text,
        trends_json
      FROM reddit_sentiment_analyses AS analysis
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY analysis.created_at DESC, analysis.id DESC
      LIMIT ?
    `,
    args,
  });

  return (result.rows as unknown as RedditSentimentAnalysisRow[]).map(mapAnalysis);
}

export async function getRedditStockMentionLists(
  filters: RedditStockMentionFilters = {}
): Promise<RedditStockMentionLists> {
  await ensureStockSchema();

  const whereClauses = ["subreddit = 'wallstreetbets'"];
  const args: string[] = [];
  const since = filters.since?.trim();

  if (since) {
    whereClauses.push("posted_at >= ?");
    args.push(since);
  }

  const [postResult, symbolResult] = await Promise.all([
    turso.execute({
      sql: `
        SELECT title, body_text, source_url, matched_keywords_json
        FROM reddit_posts
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY posted_at DESC, id DESC
      `,
      args,
    }),
    turso.execute(`
      SELECT symbol, display_name
      FROM tracked_symbols
      WHERE is_active = 1
      ORDER BY symbol ASC
    `),
  ]);
  const posts = postResult.rows as unknown as RedditPostMentionRow[];
  const symbols = symbolResult.rows as unknown as TrackedSymbolRow[];
  const limit = boundedLimit(filters.limit ?? 5);

  return {
    mostDiscussed: rankStockMentions(posts, symbols, undefined, limit),
    buy: rankStockMentions(posts, symbols, "buy", limit),
    sell: rankStockMentions(posts, symbols, "sell", limit),
  };
}
