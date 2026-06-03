"use client";

import { Activity, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMarketDateTime, getMarketSession } from "../lib/market-hours";

type MarketSession = ReturnType<typeof getMarketSession>;

type MarketStatusBadgeProps = {
  variant?: "dark" | "light";
};

const refreshMs = 60_000;

export function MarketStatusBadge({ variant = "light" }: MarketStatusBadgeProps) {
  const [session, setSession] = useState<MarketSession>(() => getMarketSession());
  const isDark = variant === "dark";
  const isOpen = session.isOpen;
  const Icon = isOpen ? Activity : Clock;
  const detail = isOpen
    ? `${session.isEarlyClose ? "Early close" : "Closes"} ${
        session.closesAt ? formatMarketDateTime(session.closesAt) : "today"
      }`
    : session.nextOpenAt
      ? `Opens ${formatMarketDateTime(session.nextOpenAt)}`
      : session.reason;
  const shellClasses = isDark
    ? isOpen
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-50"
      : "border-amber-300/30 bg-amber-300/10 text-amber-50"
    : isOpen
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-950";
  const iconClasses = isOpen
    ? isDark
      ? "text-emerald-200"
      : "text-emerald-600"
    : isDark
      ? "text-amber-200"
      : "text-amber-600";
  const dotClasses = isOpen ? "bg-emerald-400" : "bg-amber-400";
  const detailClasses = isDark ? "text-white/70" : "text-zinc-600";

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
      title={session.reason}
    >
      <span className={`h-2 w-2 rounded-full ${dotClasses}`} />
      <Icon className={`h-4 w-4 ${iconClasses}`} />
      <span className="font-medium">{isOpen ? "Market open" : "Market closed"}</span>
      <span className={`hidden sm:inline ${detailClasses}`}>{detail}</span>
    </span>
  );
}
