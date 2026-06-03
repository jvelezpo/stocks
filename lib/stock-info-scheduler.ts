import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import {
  formatMarketDateTime,
  getMarketSession,
  millisecondsUntil,
} from "./market-hours";

const stockInfoIntervalMs = 60_000;
const runWhenMarketClosedEnv = "STOCK_INFO_RUN_WHEN_MARKET_CLOSED";

type SchedulerState = {
  interval: NodeJS.Timeout | null;
  marketTimer: NodeJS.Timeout | null;
  child: ChildProcess | null;
  running: boolean;
  cleanupRegistered: boolean;
  started: boolean;
};

declare global {
  var __stockInfoScheduler: SchedulerState | undefined;
}

function schedulerState(): SchedulerState {
  globalThis.__stockInfoScheduler ??= {
    interval: null,
    marketTimer: null,
    child: null,
    running: false,
    cleanupRegistered: false,
    started: false,
  };

  return globalThis.__stockInfoScheduler;
}

function log(message: string): void {
  console.log(`[stock-info-scheduler] [${new Date().toISOString()}] ${message}`);
}

function runWhenMarketClosed(): boolean {
  return ["1", "true", "yes", "on"].includes(
    (process.env[runWhenMarketClosedEnv] ?? "").trim().toLowerCase()
  );
}

function runStockInfo(state: SchedulerState): void {
  const session = getMarketSession();

  if (!session.isOpen && !runWhenMarketClosed()) {
    log(`Skipping stock-info.ts because ${session.reason}.`);
    syncMarketSchedule(state, "market closed during run check");
    return;
  }

  if (state.running) {
    log("Skipping stock-info.ts run because the previous run is still active.");
    return;
  }

  state.running = true;
  log("Starting stock-info.ts");

  const args = existsSync(".env") ? ["--env-file=.env", "stock-info.ts"] : ["stock-info.ts"];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  let settled = false;

  state.child = child;

  const finish = (message: string): void => {
    if (settled) {
      return;
    }

    settled = true;
    log(message);

    if (state.child === child) {
      state.child = null;
    }

    state.running = false;
  };

  child.once("error", (error) => {
    finish(`stock-info.ts failed to start: ${error.message}`);
  });
  child.once("close", (code, signal) => {
    if (signal) {
      finish(`stock-info.ts stopped by ${signal}.`);
      return;
    }

    if (code === 0) {
      finish("stock-info.ts completed successfully.");
      return;
    }

    finish(`stock-info.ts exited with code ${code ?? "unknown"}.`);
  });
}

function clearStockInfoInterval(state: SchedulerState, reason: string): void {
  if (!state.interval) {
    return;
  }

  clearInterval(state.interval);
  state.interval = null;
  log(`Cleared stock-info.ts scheduler interval (${reason}).`);
}

function clearMarketTimer(state: SchedulerState): void {
  if (!state.marketTimer) {
    return;
  }

  clearTimeout(state.marketTimer);
  state.marketTimer = null;
}

function stopActiveRun(state: SchedulerState, reason: string): void {
  if (!state.child || state.child.killed) {
    return;
  }

  log(`Stopping active stock-info.ts run (${reason}).`);
  state.child.kill("SIGTERM");
}

function scheduleMarketCheck(
  state: SchedulerState,
  date: Date,
  transition: string
): void {
  clearMarketTimer(state);

  state.marketTimer = setTimeout(() => {
    state.marketTimer = null;
    syncMarketSchedule(state, transition);
  }, millisecondsUntil(date));
  state.marketTimer.unref();

  log(`Next market check: ${transition} at ${formatMarketDateTime(date)}.`);
}

function ensureStockInfoInterval(state: SchedulerState): boolean {
  if (state.interval) {
    return false;
  }

  state.interval = setInterval(() => {
    runStockInfo(state);
  }, stockInfoIntervalMs);
  state.interval.unref();

  log("Started stock-info.ts scheduler; interval=60s.");
  return true;
}

function syncMarketSchedule(state: SchedulerState, reason: string): void {
  if (!state.started) {
    return;
  }

  if (runWhenMarketClosed()) {
    clearMarketTimer(state);

    if (ensureStockInfoInterval(state)) {
      log(
        `${runWhenMarketClosedEnv}=true; market-hours gate disabled (${reason}).`
      );
      runStockInfo(state);
    }

    return;
  }

  const session = getMarketSession();

  if (session.isOpen) {
    const intervalStarted = ensureStockInfoInterval(state);

    if (session.closesAt) {
      scheduleMarketCheck(state, session.closesAt, "market close");
    }

    if (intervalStarted) {
      log(`${session.reason}; background updates enabled (${reason}).`);
      runStockInfo(state);
    }

    return;
  }

  clearStockInfoInterval(state, session.reason);
  stopActiveRun(state, session.reason);

  if (session.nextOpenAt) {
    scheduleMarketCheck(state, session.nextOpenAt, "market open");
    log(
      `${session.reason}; background updates disabled until ${formatMarketDateTime(
        session.nextOpenAt
      )}.`
    );
  }
}

function registerCleanup(state: SchedulerState): void {
  if (state.cleanupRegistered) {
    return;
  }

  state.cleanupRegistered = true;
  process.once("beforeExit", () => {
    stopStockInfoScheduler("process beforeExit");
  });
  process.once("exit", () => {
    stopStockInfoScheduler("process exit");
  });
}

export function startStockInfoScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const state = schedulerState();

  if (state.started) {
    return;
  }

  state.started = true;
  registerCleanup(state);
  syncMarketSchedule(state, "startup");
}

export function stopStockInfoScheduler(reason = "shutdown"): void {
  const state = globalThis.__stockInfoScheduler;

  if (!state) {
    return;
  }

  state.started = false;
  clearStockInfoInterval(state, reason);
  clearMarketTimer(state);

  stopActiveRun(state, reason);
}
