import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { formatDateTime } from "../lib/format";
import type { PolymarketStockMarketGroup } from "../lib/stock-reddit-analysis";

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatProbability(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function formatMarketValue(value: number | null): string {
  return value === null ? "-" : compactCurrency.format(value);
}

export function PolymarketSignals({
  groups,
}: {
  groups: PolymarketStockMarketGroup[];
}) {
  return (
    <section
      className="mx-auto max-w-7xl px-5 pb-10 sm:px-8 lg:px-10"
      id="polymarket-signals"
    >
      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Activity className="h-4 w-4 text-violet-600" />
              Prediction market monitor
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-950">
              Polymarket signals
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Active prediction markets related to tracked stocks, ranked by trading volume.
              Prices represent crowd-implied probabilities, not guarantees.
            </p>
          </div>
          <a
            className="inline-flex h-10 items-center gap-2 self-start rounded-md border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950"
            href="https://polymarket.com/predictions/stocks"
            rel="noreferrer"
            target="_blank"
          >
            Browse Polymarket
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        {groups.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
            <h3 className="text-lg font-semibold text-zinc-900">
              No active Polymarket signals
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
              No active markets matched the stocks currently shown on the dashboard.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {groups.map((group) => (
              <article
                className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5"
                key={group.symbol}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      className="text-xl font-semibold text-zinc-950 hover:text-violet-700"
                      href={`/stocks/${encodeURIComponent(group.symbol)}`}
                    >
                      {group.symbol}
                    </Link>
                    <p className="mt-1 truncate text-sm text-zinc-500">{group.name}</p>
                  </div>
                  <span className="rounded-md bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">
                    {group.markets.length} {group.markets.length === 1 ? "market" : "markets"}
                  </span>
                </div>

                <div className="mt-4 space-y-4">
                  {group.markets.map((market) => (
                    <div
                      className="border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0"
                      key={`${market.sourceUrl}-${market.market}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-violet-700">
                            {market.event || "Polymarket event"}
                          </div>
                          <h3 className="mt-1 text-sm font-semibold leading-6 text-zinc-950">
                            {market.market}
                          </h3>
                        </div>
                        <a
                          aria-label={`Open ${market.market} on Polymarket`}
                          className="shrink-0 rounded-md border border-zinc-200 bg-white p-2 text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-950"
                          href={market.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {market.outcomes.slice(0, 3).map((outcome) => (
                          <span
                            className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
                            key={outcome.label}
                          >
                            {outcome.label} {formatProbability(outcome.probability)}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <span>Volume {formatMarketValue(market.volume)}</span>
                        <span>Liquidity {formatMarketValue(market.liquidity)}</span>
                        {market.endDate ? <span>Ends {formatDateTime(market.endDate)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
