import Link from "next/link";
import { cookies } from "next/headers";
import {
  Activity,
  ArrowUpRight,
  LineChart,
} from "lucide-react";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { PageHeader } from "../components/PageHeader";
import { RedditSentimentRefreshButton } from "../components/RedditSentimentRefreshButton";
import { RedditPostLinksButton } from "../components/RedditPostLinksButton";
import { Sparkline } from "../components/Sparkline";
import { hasRole, SESSION_COOKIE_NAME, verifySessionToken } from "../lib/auth";
import { formatDateTime, formatNumber, recommendationTone, toneForChange } from "../lib/format";
import { REDDIT_KEYWORDS, type RedditKeyword } from "../lib/reddit-core";
import {
  getRedditSentimentAnalyses,
  getRedditStockMentionLists,
  type RedditStockMention,
} from "../lib/reddit";
import { getStockSummaries } from "../lib/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const redditTimeframes = ["1h", "24h", "7d", "30d", "all"] as const;
type RedditTimeframe = (typeof redditTimeframes)[number];

type DashboardPageProps = {
  searchParams: Promise<{
    keyword?: string | string[];
    timeframe?: string | string[];
  }>;
};

function firstSearchParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? "";
}

function parseRedditKeyword(value: string | string[] | undefined): RedditKeyword | undefined {
  const candidate = firstSearchParam(value);

  return REDDIT_KEYWORDS.includes(candidate as RedditKeyword)
    ? (candidate as RedditKeyword)
    : undefined;
}

function parseRedditTimeframe(value: string | string[] | undefined): RedditTimeframe {
  const candidate = firstSearchParam(value);

  return redditTimeframes.includes(candidate as RedditTimeframe)
    ? (candidate as RedditTimeframe)
    : "24h";
}

function sinceForTimeframe(timeframe: RedditTimeframe): string | undefined {
  if (timeframe === "all") {
    return undefined;
  }

  const hours = {
    "1h": 1,
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
  }[timeframe];

  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function sentimentClasses(sentiment: string): string {
  const normalized = sentiment.toLowerCase();

  if (normalized === "positive") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (normalized === "negative") {
    return "bg-red-100 text-red-800";
  }

  return "bg-zinc-100 text-zinc-700";
}

function sentimentLabel(sentiment: string): string {
  const normalized = sentiment.trim().toLowerCase();

  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Neutral";
}

function changeClasses(change: number | null): string {
  const tone = toneForChange(change);

  if (tone === "up") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (tone === "down") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

function recommendationClasses(recommendation: string): string {
  const tone = recommendationTone(recommendation);

  if (tone === "buy") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (tone === "sell") {
    return "bg-red-100 text-red-800";
  }

  if (tone === "hold") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-zinc-100 text-zinc-600";
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
          <span className="w-5 text-right text-xs font-medium text-zinc-400">
            {index + 1}
          </span>
          <Link
            className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 hover:text-emerald-700"
            href={`/stocks/${encodeURIComponent(stock.symbol)}`}
          >
            {stock.symbol}
            {stock.name ? (
              <span className="ml-2 font-normal text-zinc-500">{stock.name}</span>
            ) : null}
          </Link>
          <RedditPostLinksButton
            posts={stock.posts}
            symbol={stock.symbol}
          />
        </li>
      ))}
    </ol>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const redditKeyword = parseRedditKeyword(resolvedSearchParams.keyword);
  const redditTimeframe = parseRedditTimeframe(resolvedSearchParams.timeframe);
  const redditSince = sinceForTimeframe(redditTimeframe);
  const [stocks, redditAnalyses, redditStockMentions, session] = await Promise.all([
    getStockSummaries(),
    getRedditSentimentAnalyses({
      keyword: redditKeyword,
      since: redditSince,
      limit: 12,
    }),
    getRedditStockMentionLists({ since: redditSince, limit: 5 }),
    sessionToken ? verifySessionToken(sessionToken) : null,
  ]);
  const isAdmin = Boolean(session && hasRole(session.user.role, "admin"));
  const latestFetch = stocks
    .map((stock) => stock.fetchedAt)
    .sort()
    .at(-1);
  const historyRows = stocks.reduce((total, stock) => total + stock.historyCount, 0);
  const analyses = stocks.reduce((total, stock) => total + stock.analysisCount, 0);

  return (
    <main className="min-h-screen">
      <PageHeader>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Signal Desk
            </h1>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-white/15 bg-white/10 p-4">
                <div className="text-zinc-300">Symbols</div>
                <div className="mt-2 text-2xl font-semibold">{stocks.length}</div>
              </div>
              <div className="rounded-lg border border-white/15 bg-white/10 p-4">
                <div className="text-zinc-300">Snapshots</div>
                <div className="mt-2 text-2xl font-semibold">{historyRows}</div>
              </div>
              <div className="rounded-lg border border-white/15 bg-white/10 p-4">
                <div className="text-zinc-300">Analyses</div>
                <div className="mt-2 text-2xl font-semibold">{analyses}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
            <MarketStatusBadge variant="dark" />
            <span className="hidden h-1 w-1 rounded-full bg-zinc-500 sm:inline-block" />
            <span className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-300" />
              {latestFetch ? `Latest capture ${formatDateTime(latestFetch)}` : "No captures yet"}
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-zinc-500 sm:inline-block" />
            <span>Live data from Turso</span>
          </div>
        </div>
      </PageHeader>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        {stocks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center shadow-soft">
            <LineChart className="mx-auto h-10 w-10 text-zinc-400" />
            <h2 className="mt-4 text-2xl font-semibold text-zinc-900">No symbols stored yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-zinc-600">
              Quote history, documents, and analyses will appear here when rows exist in Turso.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stocks.map((stock) => {
              const changeLabel = [stock.changeText, stock.changePercentText]
                .filter(Boolean)
                .join(" ");
              const recommendation = stock.latestRecommendation || "No analysis";

              return (
                <Link
                  className="group rounded-lg border border-zinc-200 bg-white p-5 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg"
                  href={`/stocks/${encodeURIComponent(stock.symbol)}`}
                  key={stock.symbol}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-semibold text-zinc-950">{stock.symbol}</h2>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                            stock.latestRecommendation
                          )}`}
                        >
                          {recommendation}
                        </span>
                        {stock.latestHftDecision ? (
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                              stock.latestHftDecision
                            )}`}
                          >
                            HFT {stock.latestHftDecision}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-zinc-500">{stock.name}</p>
                    </div>
                    <span className="rounded-md border border-zinc-200 p-2 text-zinc-500 transition group-hover:border-zinc-300 group-hover:text-zinc-900">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-4xl font-semibold text-zinc-950">
                        {stock.priceText || formatNumber(stock.price)}
                      </div>
                      <div
                        className={`mt-3 inline-flex rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${changeClasses(
                          stock.change
                        )}`}
                      >
                        {changeLabel || "Flat"}
                      </div>
                    </div>
                    <Sparkline label={stock.symbol} points={stock.priceHistory} />
                  </div>

                  <div className="mt-6 grid grid-cols-3 divide-x divide-zinc-100 border-t border-zinc-100 pt-4 text-sm">
                    <div className="pr-3">
                      <div className="text-zinc-500">Market cap</div>
                      <div className="mt-1 font-semibold text-zinc-950">{stock.marketCapText || "-"}</div>
                    </div>
                    <div className="px-3">
                      <div className="text-zinc-500">Volume</div>
                      <div className="mt-1 font-semibold text-zinc-950">{stock.volumeText || "-"}</div>
                    </div>
                    <div className="pl-3">
                      <div className="text-zinc-500">Documents</div>
                      <div className="mt-1 font-semibold text-zinc-950">{stock.documentCount}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 lg:px-10"
        id="reddit-sentiment"
      >
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Activity className="h-4 w-4 text-orange-600" />
                Reddit monitor
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold text-zinc-950">
                  WallStreetBets sentiment
                </h2>
                {isAdmin ? <RedditSentimentRefreshButton /> : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                Batch-wide AI summaries of new trading discussions that mention the monitored keywords.
              </p>
            </div>

            <form
              action="/#reddit-sentiment"
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              method="get"
            >
              <label className="text-sm text-zinc-600">
                <span className="mb-1.5 block font-medium text-zinc-700">Batch contains</span>
                <select
                  className="h-10 min-w-36 rounded-md border border-zinc-200 bg-white px-3 text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  defaultValue={redditKeyword ?? "all"}
                  name="keyword"
                >
                  <option value="all">All keywords</option>
                  {REDDIT_KEYWORDS.map((keyword) => (
                    <option key={keyword} value={keyword}>
                      {keyword}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-zinc-600">
                <span className="mb-1.5 block font-medium text-zinc-700">Analyzed within</span>
                <select
                  className="h-10 min-w-36 rounded-md border border-zinc-200 bg-white px-3 text-zinc-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  defaultValue={redditTimeframe}
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
                <button
                  className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
                  type="submit"
                >
                  Apply
                </button>
                <Link
                  className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950"
                  href="/#reddit-sentiment"
                >
                  Reset
                </Link>
              </div>
            </form>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5">
              <h3 className="font-semibold text-zinc-950">Most discussed</h3>
              <p className="mt-1 text-xs text-zinc-500">Tracked stocks mentioned in the most posts</p>
              <StockMentionList
                emptyLabel="No tracked stocks were mentioned in this timeframe."
                stocks={redditStockMentions.mostDiscussed}
              />
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-5">
              <h3 className="font-semibold text-emerald-950">Buy mentions</h3>
              <p className="mt-1 text-xs text-emerald-700">Stocks mentioned in posts that include “buy”</p>
              <StockMentionList
                emptyLabel="No tracked stocks have buy mentions in this timeframe."
                stocks={redditStockMentions.buy}
              />
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-5">
              <h3 className="font-semibold text-red-950">Sell mentions</h3>
              <p className="mt-1 text-xs text-red-700">Stocks mentioned in posts that include “sell”</p>
              <StockMentionList
                emptyLabel="No tracked stocks have sell mentions in this timeframe."
                stocks={redditStockMentions.sell}
              />
            </div>
          </div>

          {redditAnalyses.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
              <h3 className="text-lg font-semibold text-zinc-900">
                No Reddit sentiment available
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
                No completed analyses match this view yet. Try broader filters, or wait for
                matching posts to be collected and analyzed.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {redditAnalyses.map((analysis) => (
                <article
                  className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5"
                  key={analysis.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3
                        className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${sentimentClasses(
                          analysis.overallSentiment
                        )}`}
                      >
                        {sentimentLabel(analysis.overallSentiment)} sentiment
                      </h3>
                      <div className="mt-3 text-sm text-zinc-500">
                        Analyzed {formatDateTime(analysis.createdAt)}
                      </div>
                    </div>
                    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-right">
                      <div className="text-xs text-zinc-500">Matching posts</div>
                      <div className="mt-1 text-lg font-semibold text-zinc-950">
                        {analysis.postCount}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {analysis.keywords.map((keyword) => (
                      <span
                        className="rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
                        key={keyword}
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 text-sm leading-6 text-zinc-700">
                    {analysis.summary || "No summary was returned for this analysis."}
                  </p>

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
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">No notable trends reported.</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 lg:px-10">
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Activity className="h-4 w-4 text-emerald-600" />
            Snapshot register
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Symbol</th>
                    <th className="px-4 py-3 font-medium">Latest capture</th>
                    <th className="px-4 py-3 font-medium">Quotes</th>
                    <th className="px-4 py-3 font-medium">Documents</th>
                    <th className="px-4 py-3 font-medium">Analysis</th>
                    <th className="px-4 py-3 font-medium">HFT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {stocks.map((stock) => (
                    <tr className="hover:bg-zinc-50" key={stock.symbol}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-zinc-950">
                        <Link className="hover:text-emerald-700" href={`/stocks/${encodeURIComponent(stock.symbol)}`}>
                          {stock.symbol}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                        {formatDateTime(stock.fetchedAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">{stock.historyCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">{stock.documentCount}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                            stock.latestRecommendation
                          )}`}
                        >
                          {stock.latestRecommendation || stock.latestAnalysisStatus || "None"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                            stock.latestHftDecision
                          )}`}
                        >
                          {stock.latestHftDecision || stock.latestHftStatus || "None"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
