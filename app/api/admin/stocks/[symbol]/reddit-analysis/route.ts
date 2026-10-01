import { NextResponse, type NextRequest } from "next/server.js";
import {
  hasRole,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "../../../../../../lib/auth.ts";
import {
  runStockRedditAnalysis,
  StockRedditAnalysisError,
} from "../../../../../../lib/stock-reddit-analysis.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ symbol: string }>;
};

export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session || !hasRole(session.user.role, "admin")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const { symbol } = await params;
    const instruction =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).instruction
        : undefined;
    const analysis = await runStockRedditAnalysis(symbol, instruction);
    return NextResponse.json({ analysis }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof StockRedditAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[stock-reddit-analysis] Request failed.", error);
    return NextResponse.json(
      { error: "The Reddit + Polymarket analysis could not be completed." },
      { status: 500 }
    );
  }
}
