export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.RUN_SCHEDULERS_IN_WEB_PROCESS !== "true"
  ) {
    return;
  }

  const [
    { startStockInfoScheduler },
    { startRedditSentimentScheduler },
    { startPolymarketScheduler },
  ] = await Promise.all([
      import("./lib/stock-info-scheduler"),
      import("./lib/reddit-sentiment-scheduler"),
      import("./lib/polymarket-scheduler"),
    ]);

  startStockInfoScheduler();
  startRedditSentimentScheduler();
  startPolymarketScheduler();
}
