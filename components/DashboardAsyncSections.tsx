import { Activity } from "lucide-react";
import Link from "next/link";
import { getCachedPolymarketStockMarketGroups } from "../lib/dashboard-cache";
import { formatDateTime } from "../lib/format";
import { REDDIT_KEYWORDS, type RedditKeyword } from "../lib/reddit-core";
import {
  getRedditSentimentAnalyses,
  getRedditStockMentionLists,
  type RedditStockMention,
} from "../lib/reddit";
import { PolymarketSignals } from "./PolymarketSignals";
import { RedditPostLinksButton } from "./RedditPostLinksButton";
import { RedditSentimentRefreshButton } from "./RedditSentimentRefreshButton";

export type RedditTimeframe = "1h" | "24h" | "7d" | "30d" | "all";

function sentimentClasses(sentiment: string): string {
  const normalized = sentiment.toLowerCase();
  if (normalized === "positive") return "bg-emerald-100 text-emerald-800";
  if (normalized === "negative") return "bg-red-100 text-red-800";
  return "bg-zinc-100 text-zinc-700";
}

function sentimentLabel(sentiment: string): string {
  const normalized = sentiment.trim().toLowerCase();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Neutral";
}

function StockMentionList({
  emptyLabel,
  stocks,
}: {
  emptyLabel: string;
  stocks: RedditStockMention[];
}) {
  if (stocks.length === 0) {
    return <p className="mt-4 text-sm text-zinc-500">{emptyLabel}</p>;
  }

  return (
    <ol className="mt-4 space-y-2">
      {stocks.map((stock, index) => (
        <li className="flex items-center gap-3" key={stock.symbol}>
          <span className="w-5 text-right text-xs font-medium text-zinc-400">{index + 1}</span>
          <Link
            className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 hover:text-emerald-700"
            href={`/stocks/${encodeURIComponent(stock.symbol)}`}
          >
            {stock.symbol}
            {stock.name ? <span className="ml-2 font-normal text-zinc-500">{stock.name}</span> : null}
          </Link>
          <RedditPostLinksButton posts={stock.posts} symbol={stock.symbol} />
        </li>
      ))}
    </ol>
  );
}

export async function RedditSentimentSection({
  isAdmin,
  keyword,
  since,
  timeframe,
}: {
  isAdmin: boolean;
  keyword?: RedditKeyword;
  since?: string;
  timeframe: RedditTimeframe;
}) {
  const [analyses, stockMentions] = await Promise.all([
    getRedditSentimentAnalyses({ keyword, since, limit: 12 }),
    getRedditStockMentionLists({ since, limit: 5 }),
  ]);

  return (
    <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 lg:px-10" id="reddit-sentiment">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Activity className="h-4 w-4 text-orange-600" />
              Reddit monitor
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-zinc-950">WallStreetBets sentiment</h2>
              {isAdmin ? <RedditSentimentRefreshButton /> : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Batch-wide AI summaries of new trading discussions that mention the monitored keywords.
            </p>
          </div>

          <form action="/#reddit-sentiment" className="flex flex-col gap-3 sm:flex-row sm:items-end" method="get">
            <label className="text-sm text-zinc-600">
              <span className="mb-1.5 block font-medium text-zinc-700">Batch contains</span>
              <select
                className="h-10 min-w-36 rounded-md border border-zinc-200 bg-white px-3 text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                defaultValue={keyword ?? "all"}
                name="keyword"
              >
                <option value="all">All keywords</option>
                {REDDIT_KEYWORDS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm text-zinc-600">
              <span className="mb-1.5 block font-medium text-zinc-700">Analyzed within</span>
              <select
                className="h-10 min-w-36 rounded-md border border-zinc-200 bg-white px-3 text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                defaultValue={timeframe}
                name="timeframe"
              >
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </label>
            <div className="flex h-10 items-center gap-2">
              <button className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800" type="submit">
                Apply
              </button>
              <Link className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950" href="/#reddit-sentiment">
                Reset
              </Link>
            </div>
          </form>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5">
            <h3 className="font-semibold text-zinc-950">Most discussed</h3>
            <p className="mt-1 text-xs text-zinc-500">Tracked stocks mentioned in the most posts</p>
            <StockMentionList emptyLabel="No tracked stocks were mentioned in this timeframe." stocks={stockMentions.mostDiscussed} />
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-5">
            <h3 className="font-semibold text-emerald-950">Buy mentions</h3>
            <p className="mt-1 text-xs text-emerald-700">Stocks mentioned in posts that include “buy”</p>
            <StockMentionList emptyLabel="No tracked stocks have buy mentions in this timeframe." stocks={stockMentions.buy} />
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-5">
            <h3 className="font-semibold text-red-950">Sell mentions</h3>
            <p className="mt-1 text-xs text-red-700">Stocks mentioned in posts that include “sell”</p>
            <StockMentionList emptyLabel="No tracked stocks have sell mentions in this timeframe." stocks={stockMentions.sell} />
          </div>
        </div>

        {analyses.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
            <h3 className="text-lg font-semibold text-zinc-900">No Reddit sentiment available</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
              No completed analyses match this view yet. Try broader filters, or wait for matching posts to be collected and analyzed.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {analyses.map((analysis) => (
              <article className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5" key={analysis.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${sentimentClasses(analysis.overallSentiment)}`}>
                      {sentimentLabel(analysis.overallSentiment)} sentiment
                    </h3>
                    <div className="mt-3 text-sm text-zinc-500">Analyzed {formatDateTime(analysis.createdAt)}</div>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-right">
                    <div className="text-xs text-zinc-500">Matching posts</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-950">{analysis.postCount}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {analysis.keywords.map((item) => (
                    <span className="rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200" key={item}>{item}</span>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-700">{analysis.summary || "No summary was returned for this analysis."}</p>
                <div className="mt-5 border-t border-zinc-200 pt-4">
                  <div className="text-sm font-semibold text-zinc-950">Notable trends</div>
                  {analysis.trends.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm text-zinc-700">
                      {analysis.trends.map((trend) => (
                        <li className="flex gap-2 leading-6" key={trend}>
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                          <span>{trend}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm text-zinc-500">No notable trends reported.</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export async function PolymarketSignalsSection({
  stocks,
}: {
  stocks: { symbol: string; name: string }[];
}) {
  const groups = await getCachedPolymarketStockMarketGroups(stocks, 3);
  return <PolymarketSignals groups={groups} />;
}

export function DashboardSectionSkeleton({ label }: { label: string }) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 lg:px-10" aria-label={`Loading ${label}`}>
      <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
        <div className="h-4 w-40 rounded bg-zinc-200" />
        <div className="mt-3 h-7 w-64 rounded bg-zinc-200" />
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="h-32 rounded-lg bg-zinc-100" />
          <div className="h-32 rounded-lg bg-zinc-100" />
        </div>
      </div>
    </section>
  );
}
