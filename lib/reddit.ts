import {
  REDDIT_KEYWORDS,
  type RedditKeyword,
  type RedditSentimentResult,
} from "./reddit-core";
import { ensureStockSchema, turso } from "./turso";

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
