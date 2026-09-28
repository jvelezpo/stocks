import type { NextRequest } from "next/server";
import { isStockChartRange } from "../../../../../lib/stock-chart";
import { getStockChartHistory } from "../../../../../lib/stocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistoryRouteContext = {
  params: Promise<{
    symbol: string;
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: HistoryRouteContext
): Promise<Response> {
  const range = request.nextUrl.searchParams.get("range");

  if (!isStockChartRange(range)) {
    return Response.json({ error: "Invalid chart range." }, { status: 400 });
  }

  try {
    const { symbol } = await params;
    const history = await getStockChartHistory(symbol, range);
    return Response.json(
      { history },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("Failed to load stock chart history", error);
    return Response.json(
      { error: "Unable to load chart data." },
      { status: 500 }
    );
  }
}
