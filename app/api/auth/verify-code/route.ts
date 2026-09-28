import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeEmail,
  verifyOtp,
  createSessionToken,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
} from "../../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as { email?: unknown; code?: unknown };
  const email = normalizeEmail(String(raw.email ?? ""));
  const code = String(raw.code ?? "").trim();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code are required." }, { status: 400 });
  }

  try {
    const user = await verifyOtp(email, code);
    const { token } = await createSessionToken(user);

    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role },
    });
    response.headers.set("Set-Cookie", buildSessionCookie(token));
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Verification failed.";
    const status =
      message.includes("Too many") || message.includes("later") ? 429 : 400;
    // Clear any stale session cookie on failure to avoid half-logged-in state.
    const response = NextResponse.json({ error: message }, { status });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }
}
