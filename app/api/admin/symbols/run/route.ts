import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasRole,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "../../../../../lib/auth.ts";
import { normalizeSymbol, listTrackedSymbols } from "../../../../../lib/symbols.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !hasRole(session.user.role, "admin")) return null;
  return session;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let symbol: string;
  try {
    const body = (await request.json()) as { symbol?: unknown } | null;
    symbol = normalizeSymbol(body?.symbol);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid symbol.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const trackedSymbols = await listTrackedSymbols(false);
  if (!trackedSymbols.some((tracked) => tracked.symbol === symbol)) {
    return NextResponse.json({ error: `${symbol} is not tracked.` }, { status: 404 });
  }

  const result = await new Promise<{ error?: string }>((resolve) => {
    const child = spawn(process.execPath, ["stock-info.ts", "--symbol", symbol], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;

    const appendOutput = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-4000);
    };
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      resolve(error ? { error } : {});
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.once("error", (error) => finish(error.message));
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = output.trim().split("\n").slice(-8).join("\n");
      finish(
        detail ||
          `Collector exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.`
      );
    });
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, symbol });
}
