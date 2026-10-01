import { getStockSummaries } from "./stocks.ts";
import { refreshPolymarketMarketSnapshots } from "./stock-reddit-analysis.ts";

const refreshIntervalMs = 300_000;

type SchedulerState = {
  interval: NodeJS.Timeout | null;
  running: boolean;
  started: boolean;
};

declare global {
  var __polymarketScheduler: SchedulerState | undefined;
}

function schedulerState(): SchedulerState {
  globalThis.__polymarketScheduler ??= {
    interval: null,
    running: false,
    started: false,
  };
  return globalThis.__polymarketScheduler;
}

function log(message: string): void {
  console.log(`[polymarket-scheduler] [${new Date().toISOString()}] ${message}`);
}

async function refresh(state: SchedulerState): Promise<void> {
  if (state.running) {
    log("Skipping refresh because the previous run is still active.");
    return;
  }

  state.running = true;
  try {
    const stocks = await getStockSummaries();
    const result = await refreshPolymarketMarketSnapshots(stocks, 10);
    log(
      `Refreshed ${result.refreshedSymbols} symbols and stored ${result.storedMarkets} markets.`
    );
  } catch (error: unknown) {
    log(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
  }
}

export function startPolymarketScheduler(): SchedulerState {
  const state = schedulerState();
  if (state.started || process.env.NEXT_PHASE === "phase-production-build") {
    return state;
  }

  state.started = true;
  state.interval = setInterval(() => {
    void refresh(state);
  }, refreshIntervalMs);
  state.interval.unref();
  log("Started Polymarket scheduler; interval=300s.");
  void refresh(state);
  return state;
}

export function stopPolymarketScheduler(): void {
  const state = globalThis.__polymarketScheduler;
  if (!state) {
    return;
  }

  state.started = false;
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
}
