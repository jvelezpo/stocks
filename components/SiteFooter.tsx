"use client";

import { Languages, Globe2 } from "lucide-react";
import { useMarketTimeZone } from "./MarketTimeZoneContext";

export function SiteFooter() {
  const { isUserTimeZone, toggleTimeZone, userTimeZone } = useMarketTimeZone();
  const label = isUserTimeZone ? "Local" : "NY";

  return (
    <footer className="border-t border-zinc-200 bg-white/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
        <span>Signal Desk</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700">
            <Languages className="h-4 w-4" />
            <select
              aria-label="Language"
              className="bg-transparent font-medium text-zinc-700 outline-none"
              defaultValue="en"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <button
            aria-label={`Show market time in ${isUserTimeZone ? "New York" : "local"} timezone`}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950"
            onClick={toggleTimeZone}
            title={`Show market time in ${isUserTimeZone ? "New York" : userTimeZone}`}
            type="button"
          >
            <Globe2 className="h-4 w-4" />
            {label}
          </button>
        </div>
      </div>
    </footer>
  );
}
