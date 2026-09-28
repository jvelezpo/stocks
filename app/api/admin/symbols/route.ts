import { NextResponse, type NextRequest } from "next/server";
import {
  verifySessionToken,
  hasRole,
  SESSION_COOKIE_NAME,
} from "../../../../lib/auth.ts";
import {
  listTrackedSymbols,
  createTrackedSymbol,
  updateTrackedSymbol,
  deleteTrackedSymbol,
} from "../../../../lib/symbols.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !hasRole(session.user.role, "admin")) return null;
  return session;
}

function toJson(symbol: {
  id: number;
  symbol: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: symbol.id,
    symbol: symbol.symbol,
    displayName: symbol.displayName,
    isActive: symbol.isActive,
    createdAt: symbol.createdAt,
    updatedAt: symbol.updatedAt,
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const symbols = await listTrackedSymbols(false);
  return NextResponse.json({ symbols: symbols.map(toJson) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as { symbol?: unknown; displayName?: unknown; isActive?: unknown };
  try {
    const created = await createTrackedSymbol({
      symbol: raw.symbol,
      displayName: raw.displayName,
      isActive: raw.isActive,
    });
    return NextResponse.json({ ok: true, symbol: toJson(created) }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not create symbol.";
    const status = message.includes("already tracked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as { id?: unknown; symbol?: unknown; displayName?: unknown; isActive?: unknown };
  if (raw.id === undefined || raw.id === null || String(raw.id).trim() === "") {
    return NextResponse.json({ error: "Symbol id is required." }, { status: 400 });
  }

  try {
    const updated = await updateTrackedSymbol(raw.id, {
      symbol: raw.symbol,
      displayName: raw.displayName,
      isActive: raw.isActive,
    });
    return NextResponse.json({ ok: true, symbol: toJson(updated) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not update symbol.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already tracked")
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  // Also accept JSON body { id } for clients that prefer it.
  let bodyId: unknown;
  if (!id) {
    try {
      const body = (await request.json()) as { id?: unknown };
      bodyId = body.id;
    } catch {
      bodyId = undefined;
    }
  }

  const targetId = id ?? bodyId;
  if (targetId === undefined || targetId === null || String(targetId).trim() === "") {
    return NextResponse.json({ error: "Symbol id is required." }, { status: 400 });
  }

  try {
    await deleteTrackedSymbol(targetId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not delete symbol.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
