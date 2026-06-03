export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function toneForChange(value: number | null): "up" | "down" | "flat" {
  if (value === null || value === 0) {
    return "flat";
  }

  return value > 0 ? "up" : "down";
}

export function recommendationTone(value: string): "buy" | "sell" | "hold" | "none" {
  const normalized = value.toUpperCase();

  if (normalized === "BUY") {
    return "buy";
  }

  if (normalized === "SELL") {
    return "sell";
  }

  if (normalized === "HOLD") {
    return "hold";
  }

  return "none";
}
