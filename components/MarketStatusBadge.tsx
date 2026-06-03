"use client";

import { Activity, AlertTriangle, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMarketDateTime, getMarketSession } from "../lib/market-hours";

type MarketSession = ReturnType<typeof getMarketSession>;

type MarketStatusBadgeProps = {
  variant?: "dark" | "light";
};

const refreshMs = 15_000;
const closingSoonMs = 15 * 60_000;

export function MarketStatusBadge({ variant = "light" }: MarketStatusBadgeProps) {
  const [session, setSession] = useState<MarketSession>(() => getMarketSession());
  const isDark = variant === "dark";
  const isOpen = session.isOpen;
  const msUntilClose = session.closesAt ? session.closesAt.getTime() - Date.now() : null;
  const isClosingSoon =
    isOpen && msUntilClose !== null && msUntilClose > 0 && msUntilClose <= closingSoonMs;
  const Icon = isClosingSoon ? AlertTriangle : isOpen ? Activity : Clock;
  const detail = isOpen
    ? isClosingSoon
      ? `Closes in ${Math.max(1, Math.ceil((msUntilClose ?? 0) / 60_000))} min`
      : `${session.isEarlyClose ? "Early close" : "Closes"} ${
          session.closesAt ? formatMarketDateTime(session.closesAt) : "today"
        }`
    : session.nextOpenAt
      ? `Opens ${formatMarketDateTime(session.nextOpenAt)}`
      : session.reason;
  const shellClasses = isDark
    ? isClosingSoon
      ? "border-red-300/50 bg-red-500/20 text-red-50 ring-2 ring-red-300/30"
      : isOpen
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-50"
      : "border-amber-300/30 bg-amber-300/10 text-amber-50"
    : isClosingSoon
      ? "border-red-300 bg-red-50 text-red-950 ring-2 ring-red-200"
      : isOpen
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-950";
  const iconClasses = isClosingSoon
    ? isDark
      ? "text-red-200"
      : "text-red-600"
    : isOpen
      ? isDark
      ? "text-emerald-200"
      : "text-emerald-600"
    : isDark
      ? "text-amber-200"
      : "text-amber-600";
  const dotClasses = isClosingSoon ? "bg-red-400" : isOpen ? "bg-emerald-400" : "bg-amber-400";
  const detailClasses = isClosingSoon
    ? isDark
      ? "text-red-100"
      : "text-red-700"
    : isDark
      ? "text-white/70"
      : "text-zinc-600";
  const label = isClosingSoon ? "Market closing soon" : isOpen ? "Market open" : "Market closed";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSession(getMarketSession());
    }, refreshMs);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${shellClasses}`}
      aria-label={`${label}. ${detail}`}
      title={`${label}. ${detail}`}
    >
      <span className={`h-2 w-2 rounded-full ${dotClasses}`} />
      <Icon className={`h-4 w-4 ${iconClasses}`} />
      <span className="font-medium">{label}</span>
      <span className={`hidden sm:inline ${detailClasses}`}>{detail}</span>
    </span>
  );
}
