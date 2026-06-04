import { startStockInfoScheduler } from "../../../lib/stock-info-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const state = startStockInfoScheduler();

  return Response.json({
    started: state.started,
    running: state.running,
    intervalActive: Boolean(state.interval),
    marketTimerActive: Boolean(state.marketTimer),
    childActive: Boolean(state.child && !state.child.killed),
    cleanupRegistered: state.cleanupRegistered,
  });
}
