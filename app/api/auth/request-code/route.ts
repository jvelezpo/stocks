import { NextResponse, type NextRequest } from "next/server";
import { normalizeEmail, isValidEmail, requestOtp, OTP_TTL_MINUTES } from "../../../../lib/auth.ts";
import { sendOtpEmail } from "../../../../lib/email.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = normalizeEmail(String((body as { email?: unknown })?.email ?? ""));
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const { code } = await requestOtp(email);
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const result = await sendOtpEmail(email, code);
      emailSent = result.sent;
    } catch (error: unknown) {
      emailError = error instanceof Error ? error.message : "Failed to send email.";
    }

    const response: Record<string, unknown> = {
      ok: true,
      expiresInMinutes: OTP_TTL_MINUTES,
      emailSent,
    };

    // In development without Resend configured, return the code so the flow
    // can be tested end-to-end. Never do this in production.
    if (!emailSent && process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
      response.debugCode = code;
    }
    if (emailError && process.env.NODE_ENV !== "production") {
      response.emailError = emailError;
    }
    if (emailError && !emailSent && process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Could not send login email. Please try again later." },
        { status: 502 }
      );
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not send code.";
    const status = message.includes("Too many") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
