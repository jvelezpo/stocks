"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { marketTimeZone } from "../lib/market-hours";

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
  }, []);

  const value = useMemo(
    () => ({
      displayTimeZone,
      isUserTimeZone,
      toggleTimeZone: () => {
        setIsUserTimeZone((current) => !current);
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
