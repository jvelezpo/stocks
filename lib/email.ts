import { Resend } from "resend";
import { OTP_TTL_MINUTES } from "./auth.ts";

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

export function getEmailConfig(): { from: string; configured: boolean } {
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  return { from, configured: Boolean(process.env.RESEND_API_KEY?.trim()) };
}

export async function sendOtpEmail(to: string, code: string): Promise<{ sent: boolean; id?: string }> {
  const { from, configured } = getEmailConfig();

  console.log('=============================');
  console.log({ code });
  console.log('=============================');

  if (!configured) {
    // Dev fallback: log the code so the flow can be tested without Resend.
    console.log(`[auth] Resend not configured. OTP for ${to}: ${code}`);
    return { sent: false };
  }

  const resend = getResend();
  if (!resend) {
    console.log(`[auth] Resend client unavailable. OTP for ${to}: ${code}`);
    return { sent: false };
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `Your login code: ${code}`,
    text: `Your login code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you did not request this code, you can ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="margin: 0 0 8px;">Your login code</h2>
        <p style="color: #52525b;">Use this code to finish signing in. It expires in ${OTP_TTL_MINUTES} minutes.</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px; background: #f4f4f5; border-radius: 8px; text-align: center;">${code}</div>
        <p style="color: #71717a; font-size: 13px;">If you did not request this code, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Failed to send login email: ${error.message}`);
  }

  return { sent: true, id: data?.id };
}
