import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getStoredPolymarketStockMarketGroups,
  getStockRedditAnalyses,
  type PolymarketStockMarketGroup,
  type StockRedditAnalysis,
} from "./stock-reddit-analysis";
import {
  getRedditSentimentAnalyses,
  getRedditStockMentionLists,
  type RedditSentimentAnalysis,
  type RedditStockMentionLists,
} from "./reddit";
import type { RedditKeyword } from "./reddit-core";
import {
  getStockChartHistory,
  getStockDetail,
  getStockSummaries,
  type StockDetail,
  type StockHistoryEntry,
  type StockSummary,
} from "./stocks";
import type { StockChartRange } from "./stock-chart";

const stockRevalidateSeconds = 60;
const redditRevalidateSeconds = 180;

const persistedStockSummaries = unstable_cache(
  getStockSummaries,
  ["stock-summaries"],
  { revalidate: stockRevalidateSeconds, tags: ["stock-data"] }
);

const persistedStockDetail = unstable_cache(
  getStockDetail,
  ["stock-detail"],
  { revalidate: stockRevalidateSeconds, tags: ["stock-data"] }
);

const persistedStockChartHistory = unstable_cache(
  getStockChartHistory,
  ["stock-chart-history"],
  { revalidate: stockRevalidateSeconds, tags: ["stock-data"] }
);

const persistedPolymarketGroups = unstable_cache(
  getStoredPolymarketStockMarketGroups,
  ["polymarket-market-snapshots"],
  { revalidate: 300, tags: ["polymarket-data"] }
);

const persistedRedditSentimentAnalyses = unstable_cache(
  (keyword: RedditKeyword | undefined, since: string | undefined, limit: number) =>
    getRedditSentimentAnalyses({ keyword, since, limit }),
  ["reddit-sentiment-analyses"],
  { revalidate: redditRevalidateSeconds, tags: ["reddit-data"] }
);

const persistedRedditStockMentionLists = unstable_cache(
  (since: string | undefined, limit: number) =>
    getRedditStockMentionLists({ since, limit }),
  ["reddit-stock-mention-lists"],
  { revalidate: redditRevalidateSeconds, tags: ["reddit-data"] }
);

const persistedStockRedditAnalyses = unstable_cache(
  getStockRedditAnalyses,
  ["stock-reddit-analyses"],
  { revalidate: redditRevalidateSeconds, tags: ["reddit-data"] }
);

export const getCachedStockSummaries = cache(
  (): Promise<StockSummary[]> => persistedStockSummaries()
);

export const getCachedStockDetail = cache(
  (symbol: string): Promise<StockDetail | null> =>
    persistedStockDetail(symbol.trim().toUpperCase())
);

export const getCachedStockChartHistory = cache(
  (symbol: string, range: StockChartRange): Promise<StockHistoryEntry[]> =>
    persistedStockChartHistory(symbol.trim().toUpperCase(), range)
);

export const getCachedPolymarketStockMarketGroups = cache(
  (
    stocks: { symbol: string; name: string }[],
    marketsPerStock = 3
  ): Promise<PolymarketStockMarketGroup[]> =>
    persistedPolymarketGroups(stocks, marketsPerStock)
);

export const getCachedRedditSentimentAnalyses = cache(
  (
    keyword: RedditKeyword | undefined,
    since: string | undefined,
    limit = 12
  ): Promise<RedditSentimentAnalysis[]> =>
    persistedRedditSentimentAnalyses(keyword, since, limit)
);

export const getCachedRedditStockMentionLists = cache(
  (since: string | undefined, limit = 5): Promise<RedditStockMentionLists> =>
    persistedRedditStockMentionLists(since, limit)
);

export const getCachedStockRedditAnalyses = cache(
  (symbol: string, limit = 5): Promise<StockRedditAnalysis[]> =>
    persistedStockRedditAnalyses(symbol.trim().toUpperCase(), limit)
);
