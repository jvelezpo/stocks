import type { NextRequest } from "next/server";
import {
  assertChatMutationOrigin,
  getChatNetworkHash,
  getChatVisitor,
  readChatMessageInput,
  sendChatMessage,
  stockChatErrorResponse,
  stockChatJson,
} from "../../../../../../../../lib/stock-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessagesRouteContext = {
  params: Promise<{
    symbol: string;
    sessionId: string;
  }>;
};

export async function POST(
  request: NextRequest,
  { params }: MessagesRouteContext
): Promise<Response> {
  const visitor = getChatVisitor(request);

  try {
    assertChatMutationOrigin(request);
    const [{ symbol, sessionId }, input] = await Promise.all([
      params,
      readChatMessageInput(request),
    ]);
    const result = await sendChatMessage(
      visitor.visitorHash,
      getChatNetworkHash(request),
      symbol,
      sessionId,
      input
    );
    return stockChatJson(visitor, result);
  } catch (error: unknown) {
    return stockChatErrorResponse(visitor, error);
  }
}
