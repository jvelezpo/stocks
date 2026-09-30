"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RefreshStatus = {
  started?: boolean;
  running: boolean;
  lastRunStatus: "idle" | "running" | "succeeded" | "failed";
  lastRunMessage: string;
};

export function RedditSentimentRefreshButton() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const isBusy = isStarting || isRefreshing;

  useEffect(() => {
    if (!isRefreshing) {
      return;
    }

    let checking = false;
    const interval = window.setInterval(() => {
      if (checking) {
        return;
      }

      checking = true;
      void fetch("/api/admin/reddit-sentiment", { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as RefreshStatus & { error?: string };
          if (!response.ok) {
            throw new Error(data.error ?? "Could not check sentiment refresh status.");
          }

          if (data.running) {
            return;
          }

          setIsRefreshing(false);
          if (data.lastRunStatus === "succeeded") {
            setMessage("WallStreetBets sentiment refreshed.");
            router.refresh();
          } else {
            setMessage(data.lastRunMessage || "The sentiment refresh failed.");
          }
        })
        .catch((error: unknown) => {
          setIsRefreshing(false);
          setMessage(error instanceof Error ? error.message : "Could not refresh sentiment.");
        })
        .finally(() => {
          checking = false;
        });
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [isRefreshing, router]);

  async function handleRefresh(): Promise<void> {
    setIsStarting(true);
    setMessage("Starting sentiment refresh…");

    try {
      const response = await fetch("/api/admin/reddit-sentiment", { method: "POST" });
      const data = (await response.json()) as RefreshStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not start sentiment refresh.");
      }

      if (!data.running) {
        if (data.lastRunStatus === "succeeded") {
          setMessage("WallStreetBets sentiment refreshed.");
          router.refresh();
        } else {
          setMessage(data.lastRunMessage || "The sentiment refresh failed.");
        }
        return;
      }

      setIsRefreshing(true);
      setMessage(
        data.started
          ? "Refreshing WallStreetBets sentiment…"
          : "A WallStreetBets sentiment refresh is already running…"
      );
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not start sentiment refresh.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-wait disabled:opacity-60"
        disabled={isBusy}
        onClick={() => void handleRefresh()}
        type="button"
      >
        <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
        {isBusy ? "Refreshing…" : "Refresh sentiment"}
      </button>
      {message ? (
        <span aria-live="polite" className="text-xs text-zinc-500" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
