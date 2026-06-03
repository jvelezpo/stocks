import { toneForChange, formatNumber } from "../lib/format";
import type { PricePoint } from "../lib/stocks";

type SparklineProps = {
  points: PricePoint[];
  label: string;
};

function buildPath(points: PricePoint[]): string {
  const width = 140;
  const height = 44;
  const padding = 3;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x =
        points.length === 1
          ? width / 2
          : padding + (index / (points.length - 1)) * (width - padding * 2);
      const y = height - padding - ((point.price - min) / range) * (height - padding * 2);

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({ points, label }: SparklineProps) {
  if (points.length < 2) {
    return (
      <div
        aria-label={`${label} price chart unavailable`}
        className="flex h-12 w-36 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-xs text-zinc-500"
      >
        No chart
      </div>
    );
  }

  const first = points[0]?.price ?? 0;
  const last = points.at(-1)?.price ?? first;
  const tone = toneForChange(last - first);
  const color = tone === "up" ? "#059669" : tone === "down" ? "#dc2626" : "#6b7280";
  const path = buildPath(points);

  return (
    <svg
      aria-label={`${label} price chart from ${formatNumber(first)} to ${formatNumber(last)}`}
      className="h-12 w-36 overflow-visible"
      role="img"
      viewBox="0 0 140 44"
    >
      <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}
