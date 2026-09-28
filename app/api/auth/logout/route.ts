import { NextResponse, type NextRequest } from "next/server";
import {
  verifySessionToken,
  revokeSession,
  buildClearedSessionCookie,
  SESSION_COOKIE_NAME,
} from "../../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      await revokeSession(session.jti);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildClearedSessionCookie());
  return response;
}
