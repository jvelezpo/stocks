import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import {
  collectorIntervalMs,
  enqueueCollectorTask,
  type QueuedCollectorTask,
} from "./collector-scheduler.ts";

const redditSentimentIntervalMs = collectorIntervalMs(
  "REDDIT_SENTIMENT_INTERVAL_MS",
  900_000
);

type RunResult = {
  status: "succeeded" | "failed";
  message: string;
};

type SchedulerState = {
  interval: NodeJS.Timeout | null;
  child: ChildProcess | null;
  queued: QueuedCollectorTask<RunResult> | null;
  running: boolean;
  cleanupRegistered: boolean;
  started: boolean;
  lastRunStatus: "idle" | "running" | "succeeded" | "failed";
  lastRunMessage: string;
  lastStartedAt: string;
  lastFinishedAt: string;
};

export type RedditSentimentRunStatus = Pick<
  SchedulerState,
  "running" | "lastRunStatus" | "lastRunMessage" | "lastStartedAt" | "lastFinishedAt"
>;

declare global {
  var __redditSentimentScheduler: SchedulerState | undefined;
}

function schedulerState(): SchedulerState {
  globalThis.__redditSentimentScheduler ??= {
    interval: null,
    child: null,
    queued: null,
    running: false,
    cleanupRegistered: false,
    started: false,
    lastRunStatus: "idle",
    lastRunMessage: "",
    lastStartedAt: "",
    lastFinishedAt: "",
  };

  const state = globalThis.__redditSentimentScheduler;
  state.queued ??= null;
  state.lastRunStatus ??= state.running ? "running" : "idle";
  state.lastRunMessage ??= "";
  state.lastStartedAt ??= "";
  state.lastFinishedAt ??= "";
  return state;
}

function log(message: string): void {
  console.log(
    `[reddit-sentiment-scheduler] [${new Date().toISOString()}] ${message}`
  );
}

function runRedditSentimentProcess(state: SchedulerState): Promise<RunResult> {
  log("Starting reddit-sentiment.ts");
  const args = existsSync(".env")
    ? ["--env-file=.env", "reddit-sentiment.ts"]
    : ["reddit-sentiment.ts"];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  state.child = child;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: RunResult["status"], message: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (state.child === child) {
        state.child = null;
      }
      resolve({ status, message });
    };

    child.once("error", (error) => {
      finish("failed", `reddit-sentiment.ts failed to start: ${error.message}`);
    });
    child.once("close", (code, signal) => {
      if (signal) {
        finish("failed", `reddit-sentiment.ts stopped by ${signal}.`);
        return;
      }

      if (code === 0) {
        finish("succeeded", "reddit-sentiment.ts completed successfully.");
        return;
      }

      finish("failed", `reddit-sentiment.ts exited with code ${code ?? "unknown"}.`);
    });
  });
}

function runRedditSentiment(state: SchedulerState): boolean {
  if (state.running) {
    log("Skipping reddit-sentiment.ts run because the previous run is still active.");
    return false;
  }

  state.running = true;
  state.lastRunStatus = "running";
  state.lastRunMessage = "";
  state.lastStartedAt = new Date().toISOString();
  log("Queued reddit-sentiment.ts for the shared browser collector slot.");
  const queued = enqueueCollectorTask(() => runRedditSentimentProcess(state));
  state.queued = queued;

  void queued.result
    .then((result) => {
      const runResult: RunResult =
        result.status === "cancelled"
          ? {
              status: "failed",
              message: "Cancelled queued reddit-sentiment.ts run.",
            }
          : result.value;
      log(runResult.message);
      state.lastRunStatus = runResult.status;
      state.lastRunMessage = runResult.message;
    })
    .catch((error: unknown) => {
      const message = `reddit-sentiment.ts queue failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      log(message);
      state.lastRunStatus = "failed";
      state.lastRunMessage = message;
    })
    .finally(() => {
      if (state.queued === queued) {
        state.queued = null;
      }
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
    });

  return true;
}

export function getRedditSentimentRunStatus(): RedditSentimentRunStatus {
  const state = schedulerState();

  return {
    running: state.running,
    lastRunStatus: state.lastRunStatus,
    lastRunMessage: state.lastRunMessage,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
  };
}

export function triggerRedditSentimentRefresh(): RedditSentimentRunStatus & {
  started: boolean;
} {
  const state = schedulerState();
  const started = runRedditSentiment(state);
  return { started, ...getRedditSentimentRunStatus() };
}

function clearRedditSentimentInterval(
  state: SchedulerState,
  reason: string
): void {
  if (!state.interval) {
    return;
  }

  clearInterval(state.interval);
  state.interval = null;
  log(`Cleared reddit-sentiment.ts scheduler interval (${reason}).`);
}

function stopActiveRun(state: SchedulerState, reason: string): void {
  if (state.queued?.cancel()) {
    log(`Cancelling queued reddit-sentiment.ts run (${reason}).`);
    return;
  }

  if (!state.child || state.child.killed) {
    return;
  }

  log(`Stopping active reddit-sentiment.ts run (${reason}).`);
  state.child.kill("SIGTERM");
}

function registerCleanup(state: SchedulerState): void {
  if (state.cleanupRegistered) {
    return;
  }

  state.cleanupRegistered = true;
  process.once("beforeExit", () => {
    stopRedditSentimentScheduler("process beforeExit");
  });
  process.once("exit", () => {
    stopRedditSentimentScheduler("process exit");
  });
}

export function startRedditSentimentScheduler(): SchedulerState {
  const state = schedulerState();

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return state;
  }

  if (state.started) {
    return state;
  }

  state.started = true;
  registerCleanup(state);

  state.interval = setInterval(() => {
    runRedditSentiment(state);
  }, redditSentimentIntervalMs);
  state.interval.unref();

  log(
    `Started reddit-sentiment.ts scheduler; interval=${
      redditSentimentIntervalMs / 1000
    }s.`
  );
  runRedditSentiment(state);
  return state;
}

export function stopRedditSentimentScheduler(reason = "shutdown"): void {
  const state = globalThis.__redditSentimentScheduler;

  if (!state) {
    return;
  }

  state.started = false;
  clearRedditSentimentInterval(state, reason);
  stopActiveRun(state, reason);
}
