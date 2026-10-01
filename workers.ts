import {
  startPolymarketScheduler,
  stopPolymarketScheduler,
} from "./lib/polymarket-scheduler.ts";
import {
  startRedditSentimentScheduler,
  stopRedditSentimentScheduler,
} from "./lib/reddit-sentiment-scheduler.ts";
import {
  startStockInfoScheduler,
  stopStockInfoScheduler,
} from "./lib/stock-info-scheduler.ts";

// Dedicated process entry point for all background collectors.
startStockInfoScheduler();
startRedditSentimentScheduler();
startPolymarketScheduler();

const keepAlive = setInterval(() => {}, 24 * 60 * 60_000);
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(keepAlive);
  stopStockInfoScheduler(signal);
  stopRedditSentimentScheduler(signal);
  stopPolymarketScheduler();

  setTimeout(() => process.exit(0), 1_000);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
