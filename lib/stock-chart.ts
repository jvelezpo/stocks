export type StockChartRange = "1d" | "5d" | "1w" | "1m" | "1y";

export const stockChartRanges: ReadonlyArray<{
  value: StockChartRange;
  label: string;
}> = [
  { value: "1d", label: "1 day" },
  { value: "5d", label: "5 days" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "1y", label: "1 year" },
];

const rangeSettings: Record<
  StockChartRange,
  { durationSeconds: number; bucketSeconds: number }
> = {
  "1d": { durationSeconds: 24 * 60 * 60, bucketSeconds: 5 * 60 },
  "5d": { durationSeconds: 5 * 24 * 60 * 60, bucketSeconds: 30 * 60 },
  "1w": { durationSeconds: 7 * 24 * 60 * 60, bucketSeconds: 60 * 60 },
  "1m": { durationSeconds: 30 * 24 * 60 * 60, bucketSeconds: 4 * 60 * 60 },
  "1y": { durationSeconds: 365 * 24 * 60 * 60, bucketSeconds: 24 * 60 * 60 },
};

export function isStockChartRange(value: string | null): value is StockChartRange {
  return stockChartRanges.some((range) => range.value === value);
}

export function stockChartRangeDurationSeconds(range: StockChartRange): number {
  return rangeSettings[range].durationSeconds;
}

export function stockChartBucketSeconds(range: StockChartRange): number {
  return rangeSettings[range].bucketSeconds;
}
