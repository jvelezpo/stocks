"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { marketTimeZone } from "../lib/market-hours";

const timeZonePreferenceStorageKey = "signal-desk-time-zone";

type MarketTimeZoneContextValue = {
  displayTimeZone: string;
  isUserTimeZone: boolean;
  toggleTimeZone: () => void;
  userTimeZone: string;
};

const MarketTimeZoneContext = createContext<MarketTimeZoneContextValue | null>(null);

type MarketTimeZoneProviderProps = {
  children: ReactNode;
};

export function MarketTimeZoneProvider({ children }: MarketTimeZoneProviderProps) {
  const [userTimeZone, setUserTimeZone] = useState(marketTimeZone);
  const [isUserTimeZone, setIsUserTimeZone] = useState(false);
  const displayTimeZone = isUserTimeZone ? userTimeZone : marketTimeZone;

  useEffect(() => {
    setUserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || marketTimeZone);

    try {
      setIsUserTimeZone(localStorage.getItem(timeZonePreferenceStorageKey) === "local");
    } catch {
      // Keep the New York default when browser storage is unavailable.
    }
  }, []);

  const value = useMemo(
    () => ({
      displayTimeZone,
      isUserTimeZone,
      toggleTimeZone: () => {
        const next = !isUserTimeZone;
        setIsUserTimeZone(next);

        try {
          localStorage.setItem(timeZonePreferenceStorageKey, next ? "local" : "market");
        } catch {
          // The in-memory preference still works when browser storage is unavailable.
        }
      },
      userTimeZone,
    }),
    [displayTimeZone, isUserTimeZone, userTimeZone]
  );

  return (
    <MarketTimeZoneContext.Provider value={value}>
      {children}
    </MarketTimeZoneContext.Provider>
  );
}

export function useMarketTimeZone(): MarketTimeZoneContextValue {
  const value = useContext(MarketTimeZoneContext);

  if (!value) {
    throw new Error("useMarketTimeZone must be used inside MarketTimeZoneProvider.");
  }

  return value;
}
