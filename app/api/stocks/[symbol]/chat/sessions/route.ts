import type { NextRequest } from "next/server";
import {
  assertChatMutationOrigin,
  createChatSession,
  getChatNetworkHash,
  getChatVisitor,
  listChatSessions,
  stockChatErrorResponse,
  stockChatJson,
} from "../../../../../../lib/stock-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionsRouteContext = {
  params: Promise<{
    symbol: string;
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: SessionsRouteContext
): Promise<Response> {
  const visitor = getChatVisitor(request);

  try {
    const { symbol } = await params;
    const sessions = await listChatSessions(visitor.visitorHash, symbol);
    return stockChatJson(visitor, { sessions });
  } catch (error: unknown) {
    return stockChatErrorResponse(visitor, error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: SessionsRouteContext
): Promise<Response> {
  const visitor = getChatVisitor(request);

  try {
    assertChatMutationOrigin(request);
    const { symbol } = await params;
    const session = await createChatSession(
      visitor.visitorHash,
      getChatNetworkHash(request),
      symbol
    );
    return stockChatJson(visitor, { session }, { status: 201 });
  } catch (error: unknown) {
    return stockChatErrorResponse(visitor, error);
  }
}
