"use client";

import { useState, type MouseEvent } from "react";
import { formatDateTime, formatNumber, toneForChange } from "../lib/format";
import type { StockHistoryEntry } from "../lib/stocks";

type RecentCapturesChartProps = {
  history: StockHistoryEntry[];
  symbol: string;
};

type ChartPoint = {
  x: number;
  y: number;
  entry: StockHistoryEntry;
};

const width = 760;
const height = 260;
const padding = {
  top: 24,
  right: 28,
  bottom: 48,
  left: 58,
};
const plotWidth = width - padding.left - padding.right;
const plotHeight = height - padding.top - padding.bottom;
const chartBottom = height - padding.bottom;
const tooltipWidth = 172;
const tooltipHeight = 56;

function buildLinePath(points: ChartPoint[]): string {
  return points
    .map((point, index) => {
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ");
}

function shortTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function chartId(symbol: string): string {
  return symbol.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

function nearestPointFromMouse(
  event: MouseEvent<SVGSVGElement>,
  points: ChartPoint[]
): ChartPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  const mouseX = ((event.clientX - rect.left) / rect.width) * width;

  return points.reduce((nearest, point) => {
    return Math.abs(point.x - mouseX) < Math.abs(nearest.x - mouseX) ? point : nearest;
  }, points[0]);
}

function tooltipPosition(point: ChartPoint): { x: number; y: number } {
  const x = Math.min(Math.max(point.x - tooltipWidth / 2, 8), width - tooltipWidth - 8);
  const y =
    point.y - tooltipHeight - 14 < 8
      ? point.y + 14
      : point.y - tooltipHeight - 14;

  return { x, y };
}

export function RecentCapturesChart({ history, symbol }: RecentCapturesChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<ChartPoint | null>(null);
  const captures = [...history].reverse();

  if (captures.length < 2) {
    return (
      <div className="mt-6 border-t border-zinc-100 pt-5">
        <div className="flex h-52 items-center justify-center text-sm text-zinc-500">
          Need at least two captures to draw a price chart.
        </div>
      </div>
    );
  }

  const prices = captures.map((entry) => entry.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const first = captures[0];
  const latest = captures.at(-1) ?? first;
  const tone = toneForChange(latest.price - first.price);
  const stroke = tone === "up" ? "#059669" : tone === "down" ? "#dc2626" : "#52525b";
  const fill = tone === "up" ? "#10b981" : tone === "down" ? "#ef4444" : "#71717a";
  const id = chartId(symbol);
  const points = captures.map((entry, index) => {
    const x =
      padding.left + (index / (captures.length - 1)) * plotWidth;
    const y = padding.top + ((max - entry.price) / range) * plotHeight;

    return { x, y, entry };
  });
  const firstPoint = points[0];
  const middlePoint = points[Math.floor(points.length / 2)];
  const lastPoint = points[points.length - 1];
  const linePath = buildLinePath(points);
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${chartBottom} L ${firstPoint.x.toFixed(2)} ${chartBottom} Z`;
  const activePoint = hoveredPoint ?? lastPoint;
  const activeTooltip = tooltipPosition(activePoint);
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const y = padding.top + ratio * plotHeight;
    const value = max - ratio * range;

    return { y, value };
  });
  const xLabels: ChartPoint[] = [];

  for (const point of [firstPoint, middlePoint, lastPoint]) {
    if (!xLabels.some((label) => label.x === point.x)) {
      xLabels.push(point);
    }
  }

  return (
    <div className="mt-6 border-t border-zinc-100 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-zinc-500">Price path</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-950">
            {latest.priceText}
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-zinc-100 text-right text-sm sm:min-w-80">
          <div className="pr-3">
            <div className="text-zinc-500">Low</div>
            <div className="mt-1 font-semibold text-zinc-950">{formatNumber(min)}</div>
          </div>
          <div className="px-3">
            <div className="text-zinc-500">High</div>
            <div className="mt-1 font-semibold text-zinc-950">{formatNumber(max)}</div>
          </div>
          <div className="pl-3">
            <div className="text-zinc-500">Latest</div>
            <div className="mt-1 font-semibold text-zinc-950">{shortTime(latest.fetchedAt)}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden">
        <svg
          aria-label={`${symbol} recent captures chart from ${formatDateTime(
            first.fetchedAt
          )} to ${formatDateTime(latest.fetchedAt)}`}
          className="h-auto w-full overflow-visible"
          onMouseLeave={() => setHoveredPoint(null)}
          onMouseMove={(event) => setHoveredPoint(nearestPointFromMouse(event, points))}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={`capture-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity="0.22" />
              <stop offset="100%" stopColor={fill} stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((line) => (
            <g key={line.y}>
              <line
                stroke="#e4e4e7"
                strokeDasharray="4 6"
                strokeWidth="1"
                x1={padding.left}
                x2={width - padding.right}
                y1={line.y}
                y2={line.y}
              />
              <text
                fill="#71717a"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 12}
                y={line.y + 4}
              >
                {formatNumber(line.value)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#capture-fill-${id})`} />
          <path
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />

          {points.map((point) => (
            <circle
              cx={point.x}
              cy={point.y}
              fill="#fff"
              key={point.entry.id}
              r="4"
              stroke={stroke}
              strokeWidth="2"
            />
          ))}

          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            fill={stroke}
            r="5"
          />

          {hoveredPoint ? (
            <g pointerEvents="none">
              <line
                stroke="#a1a1aa"
                strokeDasharray="4 5"
                strokeWidth="1"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padding.top}
                y2={chartBottom}
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                fill={stroke}
                r="6"
                stroke="#fff"
                strokeWidth="2"
              />
              <rect
                fill="#18181b"
                height={tooltipHeight}
                rx="6"
                width={tooltipWidth}
                x={activeTooltip.x}
                y={activeTooltip.y}
              />
              <text
                fill="#fafafa"
                fontSize="13"
                fontWeight="600"
                x={activeTooltip.x + 12}
                y={activeTooltip.y + 22}
              >
                {activePoint.entry.priceText || formatNumber(activePoint.entry.price)}
              </text>
              <text
                fill="#d4d4d8"
                fontSize="11"
                x={activeTooltip.x + 12}
                y={activeTooltip.y + 42}
              >
                {formatDateTime(activePoint.entry.fetchedAt)}
              </text>
            </g>
          ) : null}

          {xLabels.map((point) => (
            <text
              fill="#71717a"
              fontSize="11"
              key={point.entry.id}
              textAnchor={point.x === padding.left ? "start" : point.x > width / 2 ? "end" : "middle"}
              x={point.x}
              y={height - 14}
            >
              {shortTime(point.entry.fetchedAt)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
