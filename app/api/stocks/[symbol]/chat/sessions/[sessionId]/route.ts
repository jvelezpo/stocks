import type { NextRequest } from "next/server";
import {
  getChatSession,
  getChatVisitor,
  stockChatErrorResponse,
  stockChatJson,
} from "../../../../../../../lib/stock-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRouteContext = {
  params: Promise<{
    symbol: string;
    sessionId: string;
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: SessionRouteContext
): Promise<Response> {
  const visitor = getChatVisitor(request);

  try {
    const { symbol, sessionId } = await params;
    const result = await getChatSession(
      visitor.visitorHash,
      symbol,
      sessionId
    );
    return stockChatJson(visitor, result);
  } catch (error: unknown) {
    return stockChatErrorResponse(visitor, error);
  }
}
