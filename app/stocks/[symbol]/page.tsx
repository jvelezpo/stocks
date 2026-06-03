import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  History,
  LineChart,
} from "lucide-react";
import { Sparkline } from "../../../components/Sparkline";
import { MarketStatusBadge } from "../../../components/MarketStatusBadge";
import { PageHeader } from "../../../components/PageHeader";
import {
  formatDateTime,
  formatNumber,
  recommendationTone,
  toneForChange,
} from "../../../lib/format";
import { RecentCapturesChart } from "../../../components/RecentCapturesChart";
import { SymbolPageRefresher } from "../../../components/SymbolPageRefresher";
import { getStockDetail } from "../../../lib/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SymbolPageProps = {
  params: Promise<{
    symbol: string;
  }>;
};

type ParsedHftAnalysis = {
  decision?: string;
  confidence?: number;
  market_regime?: string;
  patterns_detected?: {
    name?: string;
    direction?: string;
    strength?: number;
    evidence?: string;
  }[];
  key_factors?: string[];
  risk_checks?: Record<string, boolean>;
  trade_plan?: {
    entry_bias?: string;
    stop_loss?: number | null;
    take_profit?: number | null;
    time_horizon_seconds?: number;
    invalidate_if?: string;
  };
  reasoning_summary?: string;
};

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

function formatConfidence(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return `${Math.round(value * 100)}%`;
}

function formatHftLabel(value: string): string {
  return value.replace(/_/g, " ") || "-";
}

function parseHftAnalysisText(text: string): ParsedHftAnalysis | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ParsedHftAnalysis)
      : null;
  } catch {
    return null;
  }
}

function hftDecisionGuidance(decision: string): string {
  const normalized = decision.toUpperCase();

  if (normalized === "BUY") {
    return "Bias is long. Consider buying only if your own risk limits agree with the plan below.";
  }

  if (normalized === "SELL") {
    return "Bias is bearish. Consider reducing exposure or selling only if your risk limits agree.";
  }

  if (normalized === "HOLD") {
    return "No trade. Wait for cleaner evidence before opening or adding to a position.";
  }

  return "No clear action available from this signal.";
}

function formatPlanNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toString() : "-";
}

function formatPlanSeconds(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value}s` : "-";
}

export async function generateMetadata({ params }: SymbolPageProps): Promise<Metadata> {
  const { symbol } = await params;
  const detail = await getStockDetail(symbol);

  if (!detail) {
    return {
      title: "Symbol not found",
    };
  }

  return {
    title: `${detail.latest.symbol} | Stocks Dashboard`,
    description: detail.latest.name,
  };
}

export default async function SymbolPage({ params }: SymbolPageProps) {
  const { symbol } = await params;
  const detail = await getStockDetail(symbol);

  if (!detail) {
    notFound();
  }

  const { latest, history, documents, analyses, hftAnalyses } = detail;
  const latestAnalysis = analyses[0];
  const latestHftAnalysis = hftAnalyses[0];
  const parsedHftAnalysis = latestHftAnalysis
    ? parseHftAnalysisText(latestHftAnalysis.analysisText)
    : null;
  const changeLabel = [latest.changeText, latest.changePercentText].filter(Boolean).join(" ");
  const metricItems = [
    ["Previous close", latest.previousCloseText],
    ["Open", latest.openText],
    ["Day range", latest.dayRangeText],
    ["Market cap", latest.marketCapText],
    ["Volume", latest.volumeText],
  ];

  return (
    <main className="min-h-screen">
      <SymbolPageRefresher />
      <PageHeader>
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/15 hover:text-white"
              href="/"
            >
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <MarketStatusBadge variant="dark" />
              <a
                className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/15 hover:text-white"
                href={latest.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Source
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-zinc-200">
                <Database className="h-4 w-4 text-emerald-300" />
                {formatDateTime(latest.fetchedAt)}
              </div>
              <h1 className="text-5xl font-semibold leading-tight sm:text-6xl">{latest.symbol}</h1>
              <p className="mt-3 max-w-3xl text-lg text-zinc-300">{latest.name}</p>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/10 p-5">
              <div className="text-sm text-zinc-300">Latest price</div>
              <div className="mt-2 text-4xl font-semibold">{latest.priceText || formatNumber(latest.price)}</div>
              <div
                className={`mt-3 inline-flex rounded-md px-2.5 py-1 text-sm font-medium ring-1 ${changeClasses(
                  latest.change
                )}`}
              >
                {changeLabel || "Flat"}
              </div>
            </div>
          </div>
        </div>
      </PageHeader>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-6 sm:px-8 md:grid-cols-2 lg:grid-cols-5 lg:px-10">
        {metricItems.map(([label, value]) => (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-soft" key={label}>
            <div className="text-sm text-zinc-500">{label}</div>
            <div className="mt-2 text-lg font-semibold text-zinc-950">{value || "-"}</div>
          </div>
        ))}
      </section>

      <section className="mx-auto grid w-full min-w-0 max-w-7xl gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-10">
        <div className="min-w-0 space-y-5">
          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <LineChart className="h-4 w-4 text-emerald-600" />
                  Price trend
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-zinc-950">Recent captures ({history.length})</h2>
              </div>
              <Sparkline label={latest.symbol} points={latest.priceHistory} />
            </div>

            <RecentCapturesChart history={history} symbol={latest.symbol} />

            <div className="mt-6 max-w-full overflow-hidden rounded-lg border border-zinc-200">
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="px-2 py-3 font-medium sm:px-4">Captured</th>
                      <th className="px-2 py-3 font-medium sm:px-4">Price</th>
                      <th className="px-2 py-3 font-medium sm:px-4">Change</th>
                      <th className="hidden px-2 py-3 font-medium sm:px-4 md:table-cell">Market cap</th>
                      <th className="hidden px-2 py-3 font-medium sm:px-4 md:table-cell">Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {history.map((entry) => (
                      <tr className="hover:bg-zinc-50" key={entry.id}>
                        <td className="whitespace-nowrap px-2 py-3 text-zinc-600 sm:px-4">
                          {formatDateTime(entry.fetchedAt)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 font-semibold text-zinc-950 sm:px-4">
                          {entry.priceText}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 sm:px-4">
                          <span
                            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ${changeClasses(
                              entry.change
                            )}`}
                          >
                            {[entry.changeText, entry.changePercentText].filter(Boolean).join(" ") || "Flat"}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-2 py-3 text-zinc-600 sm:px-4 md:table-cell">
                          {entry.marketCapText || "-"}
                        </td>
                        <td className="hidden whitespace-nowrap px-2 py-3 text-zinc-600 sm:px-4 md:table-cell">
                          {entry.volumeText || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Gauge className="h-4 w-4 text-violet-600" />
              Quote stats
            </div>
            <div className="mt-5 grid gap-x-6 gap-y-4 border-t border-zinc-100 pt-5 sm:grid-cols-2">
              {latest.stats.map((stat) => (
                <div key={stat.label}>
                  <div className="text-sm text-zinc-500">{stat.label}</div>
                  <div className="mt-2 font-semibold text-zinc-950">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="min-w-0 space-y-5">
          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Gauge className="h-4 w-4 text-emerald-600" />
                High frequency signal
              </div>
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                  latestHftAnalysis?.decision ?? ""
                )}`}
              >
                {latestHftAnalysis?.decision || "None"}
              </span>
            </div>

            {latestHftAnalysis ? (
              <div className="mt-5">
                <div className="grid grid-cols-3 divide-x divide-zinc-100 border-y border-zinc-100 py-4 text-sm">
                  <div className="pr-3">
                    <div className="text-zinc-500">Confidence</div>
                    <div className="mt-1 font-semibold text-zinc-950">
                      {formatConfidence(latestHftAnalysis.confidence)}
                    </div>
                  </div>
                  <div className="px-3">
                    <div className="text-zinc-500">Regime</div>
                    <div className="mt-1 font-semibold capitalize text-zinc-950">
                      {latestHftAnalysis.marketRegime.replace(/_/g, " ") || "-"}
                    </div>
                  </div>
                  <div className="pl-3">
                    <div className="text-zinc-500">Status</div>
                    <div className="mt-1 font-semibold text-zinc-950">
                      {latestHftAnalysis.status}
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-sm text-zinc-500">
                  {formatDateTime(latestHftAnalysis.createdAt)}
                </div>
                <div className="mt-1 break-words text-sm font-semibold text-zinc-950">
                  {latestHftAnalysis.model}
                </div>
                <div className="mt-4 border-l-2 border-emerald-200 pl-4">
                  <div className="text-base font-semibold text-zinc-950">
                    {hftDecisionGuidance(latestHftAnalysis.decision)}
                  </div>
                  {parsedHftAnalysis?.reasoning_summary ? (
                    <p className="mt-2 text-sm leading-6 text-zinc-700">
                      {parsedHftAnalysis.reasoning_summary}
                    </p>
                  ) : null}
                </div>

                {parsedHftAnalysis ? (
                  <div className="mt-5 space-y-5 text-sm">
                    {parsedHftAnalysis.key_factors?.length ? (
                      <div>
                        <div className="font-semibold text-zinc-950">Key reasons</div>
                        <ul className="mt-2 space-y-2 text-zinc-700">
                          {parsedHftAnalysis.key_factors.map((factor) => (
                            <li className="leading-6" key={factor}>
                              {factor}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {parsedHftAnalysis.patterns_detected?.length ? (
                      <div>
                        <div className="font-semibold text-zinc-950">Patterns</div>
                        <div className="mt-2 space-y-3">
                          {parsedHftAnalysis.patterns_detected.slice(0, 3).map((pattern, index) => (
                            <div className="border-t border-zinc-100 pt-3" key={`${pattern.name}-${index}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-zinc-950">
                                  {formatHftLabel(pattern.name || "Pattern")}
                                </span>
                                <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium capitalize text-zinc-600">
                                  {formatHftLabel(pattern.direction || "neutral")}
                                </span>
                                {typeof pattern.strength === "number" ? (
                                  <span className="text-xs text-zinc-500">
                                    strength {Math.round(pattern.strength * 100)}%
                                  </span>
                                ) : null}
                              </div>
                              {pattern.evidence ? (
                                <p className="mt-1 leading-6 text-zinc-700">{pattern.evidence}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {parsedHftAnalysis.trade_plan ? (
                      <div>
                        <div className="font-semibold text-zinc-950">Trade plan</div>
                        <div className="mt-2 grid grid-cols-2 gap-3 border-y border-zinc-100 py-3">
                          <div>
                            <div className="text-zinc-500">Entry</div>
                            <div className="mt-1 font-medium capitalize text-zinc-950">
                              {formatHftLabel(parsedHftAnalysis.trade_plan.entry_bias || "none")}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500">Horizon</div>
                            <div className="mt-1 font-medium text-zinc-950">
                              {formatPlanSeconds(parsedHftAnalysis.trade_plan.time_horizon_seconds)}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500">Stop loss</div>
                            <div className="mt-1 font-medium text-zinc-950">
                              {formatPlanNumber(parsedHftAnalysis.trade_plan.stop_loss)}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500">Take profit</div>
                            <div className="mt-1 font-medium text-zinc-950">
                              {formatPlanNumber(parsedHftAnalysis.trade_plan.take_profit)}
                            </div>
                          </div>
                        </div>
                        {parsedHftAnalysis.trade_plan.invalidate_if ? (
                          <p className="mt-2 leading-6 text-zinc-700">
                            Invalidate if {parsedHftAnalysis.trade_plan.invalidate_if}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {parsedHftAnalysis.risk_checks ? (
                      <div>
                        <div className="font-semibold text-zinc-950">Risk checks</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(parsedHftAnalysis.risk_checks).map(([label, passed]) => (
                            <span
                              className={`rounded-md px-2 py-1 text-xs font-medium ${
                                passed
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-red-50 text-red-700"
                              }`}
                              key={label}
                            >
                              {passed ? "OK" : "Watch"} {formatHftLabel(label)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
                    {latestHftAnalysis.errorText ||
                      latestHftAnalysis.analysisText ||
                      "No high frequency output stored."}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-zinc-600">
                No high frequency analysis rows are stored for this symbol.
              </p>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <ArrowUpRight className="h-4 w-4 text-amber-600" />
                Latest analysis
              </div>
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium ${recommendationClasses(
                  latestAnalysis?.recommendation ?? ""
                )}`}
              >
                {latestAnalysis?.recommendation || "None"}
              </span>
            </div>

            {latestAnalysis ? (
              <div className="mt-5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-zinc-500">Status</div>
                    <div className="mt-1 font-semibold text-zinc-950">{latestAnalysis.status}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Model</div>
                    <div className="mt-1 break-words font-semibold text-zinc-950">{latestAnalysis.model}</div>
                  </div>
                </div>
                <div className="mt-4 text-sm text-zinc-500">
                  {formatDateTime(latestAnalysis.createdAt)}
                </div>
                <div className="mt-4 max-h-[28rem] overflow-auto border-l-2 border-zinc-200 pl-4 text-sm leading-6 text-zinc-700">
                  <pre className="whitespace-pre-wrap break-words font-sans">
                    {latestAnalysis.analysisText || latestAnalysis.errorText || "No analysis text stored."}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-zinc-600">No analysis rows are stored for this symbol.</p>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <FileText className="h-4 w-4 text-violet-600" />
              Captured documents
            </div>
            <div className="mt-5 space-y-4">
              {documents.length === 0 ? (
                <p className="text-sm leading-6 text-zinc-600">No document rows are stored for this symbol.</p>
              ) : (
                documents.map((document) => (
                  <article className="border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0" key={document.id}>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold leading-6 text-zinc-950">{document.title || latest.symbol}</h2>
                      <a
                        className="rounded-md border border-zinc-200 p-2 text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
                        href={document.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {formatDateTime(document.capturedAt)}
                    </div>
                    <p className="mt-3 line-clamp-6 text-sm leading-6 text-zinc-600">
                      {document.bodyPreview || "No preview text stored."}
                    </p>
                    <div className="mt-3 text-xs text-zinc-500">
                      {formatNumber(document.bodyCharCount)} chars
                      {document.wasTruncated ? " captured with truncation" : " captured"}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <History className="h-4 w-4 text-emerald-600" />
              Stored rows
            </div>
            <dl className="mt-5 grid grid-cols-4 divide-x divide-zinc-100 border-t border-zinc-100 pt-4 text-center">
              <div className="px-2">
                <dt className="text-xs text-zinc-500">Quotes</dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">{latest.historyCount}</dd>
              </div>
              <div className="px-2">
                <dt className="text-xs text-zinc-500">Docs</dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">{latest.documentCount}</dd>
              </div>
              <div className="px-2">
                <dt className="text-xs text-zinc-500">Runs</dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">{latest.analysisCount}</dd>
              </div>
              <div className="px-2">
                <dt className="text-xs text-zinc-500">HFT</dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">{latest.hftCount}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>
    </main>
  );
}
