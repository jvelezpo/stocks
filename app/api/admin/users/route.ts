import { NextResponse, type NextRequest } from "next/server";
import {
  verifySessionToken,
  listUsers,
  updateUserRole,
  countAdmins,
  isUserRole,
  hasRole,
  SESSION_COOKIE_NAME,
  type UserRole,
} from "../../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !hasRole(session.user.role, "admin")) return null;
  return session;
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const users = await listUsers(200);
  return NextResponse.json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      isActive: user.isActive,
    })),
  });
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

  const raw = body as { userId?: unknown; role?: unknown };
  const userId = String(raw.userId ?? "").trim();
  const role = String(raw.role ?? "").trim() as UserRole;

  if (!userId || !isUserRole(role)) {
    return NextResponse.json(
      { error: "userId and a valid role (admin, user, guest) are required." },
      { status: 400 }
    );
  }

  // Prevent locking yourself out: don't let the last admin demote themselves.
  if (session.user.id === userId && session.user.role === "admin" && role !== "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "You are the last admin. Promote someone else first." },
        { status: 400 }
      );
    }
  }

  const updated = await updateUserRole(userId, role);
  if (!updated) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, email: updated.email, role: updated.role },
  });
}
