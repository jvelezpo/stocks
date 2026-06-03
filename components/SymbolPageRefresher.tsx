"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const refreshIntervalMs = 60_000;

export function SymbolPageRefresher() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      router.refresh();
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
