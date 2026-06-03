import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  LineChart,
} from "lucide-react";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { PageHeader } from "../components/PageHeader";
import { Sparkline } from "../components/Sparkline";
import { formatDateTime, formatNumber, recommendationTone, toneForChange } from "../lib/format";
import { getStockSummaries } from "../lib/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export default async function DashboardPage() {
  const stocks = await getStockSummaries();
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
