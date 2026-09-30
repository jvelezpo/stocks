import { NextResponse, type NextRequest } from "next/server.js";
import {
  hasRole,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "../../../../lib/auth.ts";
import {
  getRedditSentimentRunStatus,
  triggerRedditSentimentRefresh,
} from "../../../../lib/reddit-sentiment-scheduler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  return Boolean(session && hasRole(session.user.role, "admin"));
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  return NextResponse.json(getRedditSentimentRunStatus());
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  return NextResponse.json(triggerRedditSentimentRefresh(), { status: 202 });
}
