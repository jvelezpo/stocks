export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const [{ startStockInfoScheduler }, { startRedditSentimentScheduler }] =
    await Promise.all([
      import("./lib/stock-info-scheduler"),
      import("./lib/reddit-sentiment-scheduler"),
    ]);

  startStockInfoScheduler();
  startRedditSentimentScheduler();
}
