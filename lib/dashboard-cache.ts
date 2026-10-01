import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getStoredPolymarketStockMarketGroups,
  type PolymarketStockMarketGroup,
} from "./stock-reddit-analysis";
import {
  getStockChartHistory,
  getStockDetail,
  getStockSummaries,
  type StockDetail,
  type StockHistoryEntry,
  type StockSummary,
} from "./stocks";
import type { StockChartRange } from "./stock-chart";

const stockRevalidateSeconds = 30;

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
