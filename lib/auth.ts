import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import * as jose from "jose";
import { turso } from "./turso.ts";

export const USER_ROLES = ["admin", "user", "guest"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type User = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  isActive: boolean;
};

export const SESSION_COOKIE_NAME = "stocks_session";
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_REQUEST_LIMIT_PER_HOUR = 5;
export const SESSION_TTL_DAYS = 7;

const ROLE_LEVELS: Record<UserRole, number> = {
  guest: 0,
  user: 1,
  admin: 2,
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hasRole(userRole: UserRole, required: UserRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[required];
}

export function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter((email) => email.length > 0 && isValidEmail(email))
  );
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "Missing or weak AUTH_SECRET. Set AUTH_SECRET to a random string of at least 32 characters."
    );
  }
  return secret;
}

export function generateOtpCode(): string {
  let code = "";
  for (let i = 0; i < OTP_LENGTH; i += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

export function hashOtpCode(code: string, email: string): string {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${code}:${getAuthSecret()}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function ensureAuthSchema(): Promise<void> {
  await turso.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'guest')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

    CREATE TABLE IF NOT EXISTS auth_otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_email_created
      ON auth_otp_codes (email, created_at DESC);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
      ON auth_sessions (user_id);
  `);
}

type UserRow = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
  last_login_at: string;
  is_active: number;
};

function mapUser(row: UserRow): User {
  const role = isUserRole(row.role) ? row.role : "user";
  return {
    id: String(row.id),
    email: String(row.email),
    role,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastLoginAt: String(row.last_login_at ?? ""),
    isActive: Number(row.is_active) === 1,
  };
}

export async function getUserByEmail(email: string): Promise<User | null> {
  await ensureAuthSchema();
  const normalized = normalizeEmail(email);
  const result = await turso.execute({
    sql: "SELECT id, email, role, created_at, updated_at, last_login_at, is_active FROM users WHERE email = ? LIMIT 1",
    args: [normalized],
  });
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0] as unknown as UserRow);
}

export async function getUserById(id: string): Promise<User | null> {
  await ensureAuthSchema();
  const result = await turso.execute({
    sql: "SELECT id, email, role, created_at, updated_at, last_login_at, is_active FROM users WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0] as unknown as UserRow);
}

async function insertUser(email: string, role: UserRole): Promise<User> {
  const now = new Date().toISOString();
  const user: User = {
    id: randomUUID(),
    email: normalizeEmail(email),
    role,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: "",
    isActive: true,
  };
  await turso.execute({
    sql: "INSERT INTO users (id, email, role, created_at, updated_at, last_login_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    args: [user.id, user.email, user.role, user.createdAt, user.updatedAt, user.lastLoginAt],
  });
  return user;
}

export async function findOrCreateUser(email: string): Promise<{ user: User; created: boolean }> {
  await ensureAuthSchema();
  const normalized = normalizeEmail(email);
  const existing = await getUserByEmail(normalized);
  if (existing) {
    // Auto-promote bootstrap admins on login; never auto-demote.
    if (getAdminEmails().has(normalized) && existing.role !== "admin") {
      await turso.execute({
        sql: "UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?",
        args: [new Date().toISOString(), existing.id],
      });
      return { user: { ...existing, role: "admin" }, created: false };
    }
    return { user: existing, created: false };
  }

  const role: UserRole = getAdminEmails().has(normalized) ? "admin" : "user";
  const user = await insertUser(normalized, role);
  return { user, created: true };
}

export async function listUsers(limit = 100): Promise<User[]> {
  await ensureAuthSchema();
  const bounded = Math.min(Math.max(limit, 1), 500);
  const result = await turso.execute({
    sql: "SELECT id, email, role, created_at, updated_at, last_login_at, is_active FROM users ORDER BY created_at DESC LIMIT ?",
    args: [bounded],
  });
  return (result.rows as unknown as UserRow[]).map(mapUser);
}

export async function updateUserRole(userId: string, role: UserRole): Promise<User | null> {
  await ensureAuthSchema();
  if (!isUserRole(role)) throw new Error(`Invalid role: ${role}`);
  await turso.execute({
    sql: "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
    args: [role, new Date().toISOString(), userId],
  });
  return getUserById(userId);
}

export async function countAdmins(): Promise<number> {
  await ensureAuthSchema();
  const result = await turso.execute(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1"
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function requestOtp(email: string): Promise<{ user: User; code: string; expiresAt: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Invalid email address.");
  }

  const { user } = await findOrCreateUser(normalized);

  if (!user.isActive) {
    throw new Error("This account has been deactivated.");
  }

  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await turso.execute({
    sql: "SELECT COUNT(*) AS count FROM auth_otp_codes WHERE email = ? AND created_at >= ?",
    args: [normalized, windowStart],
  });
  if (Number(recent.rows[0]?.count ?? 0) >= OTP_REQUEST_LIMIT_PER_HOUR) {
    throw new Error("Too many codes requested. Please try again later.");
  }

  const code = generateOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await turso.execute({
    sql: "INSERT INTO auth_otp_codes (user_id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [user.id, normalized, hashOtpCode(code, normalized), expiresAt, now.toISOString()],
  });

  return { user, code, expiresAt };
}

export async function verifyOtp(email: string, code: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const trimmedCode = code.trim();
  if (!isValidEmail(normalized) || !new RegExp(`^\\d{${OTP_LENGTH}}$`).test(trimmedCode)) {
    throw new Error("Invalid email or code.");
  }

  const user = await getUserByEmail(normalized);
  if (!user) {
    throw new Error("Invalid email or code.");
  }
  if (!user.isActive) {
    throw new Error("This account has been deactivated.");
  }

  const now = new Date().toISOString();
  const candidate = await turso.execute({
    sql: `SELECT id, code_hash, expires_at, consumed_at, attempt_count
          FROM auth_otp_codes
          WHERE email = ? AND consumed_at = '' AND expires_at > ?
          ORDER BY created_at DESC LIMIT 1`,
    args: [normalized, now],
  });

  if (candidate.rows.length === 0) {
    throw new Error("Code expired or not found. Request a new one.");
  }

  const row = candidate.rows[0] as unknown as {
    id: number;
    code_hash: string;
    expires_at: string;
    consumed_at: string;
    attempt_count: number;
  };

  if (Number(row.attempt_count) >= OTP_MAX_ATTEMPTS) {
    throw new Error("Too many attempts. Request a new code.");
  }

  const expected = String(row.code_hash);
  const actual = hashOtpCode(trimmedCode, normalized);

  if (!safeEqualHex(expected, actual)) {
    await turso.execute({
      sql: "UPDATE auth_otp_codes SET attempt_count = attempt_count + 1 WHERE id = ?",
      args: [row.id],
    });
    throw new Error("Invalid code.");
  }

  const loginAt = new Date().toISOString();
  await turso.execute({
    sql: "UPDATE auth_otp_codes SET consumed_at = ?, attempt_count = attempt_count + 1 WHERE id = ?",
    args: [loginAt, row.id],
  });

  // Promote bootstrap admins on successful verification.
  let role = user.role;
  if (getAdminEmails().has(normalized) && role !== "admin") {
    role = "admin";
    await turso.execute({
      sql: "UPDATE users SET role = 'admin', updated_at = ?, last_login_at = ? WHERE id = ?",
      args: [loginAt, loginAt, user.id],
    });
  } else {
    await turso.execute({
      sql: "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
      args: [loginAt, loginAt, user.id],
    });
  }

  return { ...user, role, lastLoginAt: loginAt };
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: UserRole;
  jti: string;
};

export async function createSessionToken(user: User): Promise<{ token: string; jti: string; expiresAt: string }> {
  const secret = new TextEncoder().encode(getAuthSecret());
  const jti = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await ensureAuthSchema();
  await turso.execute({
    sql: "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [jti, user.id, now.toISOString(), expiresAt],
  });

  const token = await new jose.SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret);

  return { token, jti, expiresAt };
}

export async function verifySessionToken(token: string): Promise<(SessionPayload & { user: User }) | null> {
  try {
    const secret = new TextEncoder().encode(getAuthSecret());
    const { payload } = await jose.jwtVerify(token, secret);
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const jti = typeof payload.jti === "string" ? payload.jti : null;
    if (!sub || !jti) return null;

    await ensureAuthSchema();
    const session = await turso.execute({
      sql: "SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE id = ? LIMIT 1",
      args: [jti],
    });
    if (session.rows.length === 0) return null;
    const sessionRow = session.rows[0] as unknown as {
      user_id: string;
      expires_at: string;
      revoked_at: string;
    };
    if (sessionRow.revoked_at) return null;
    if (new Date(sessionRow.expires_at).getTime() <= Date.now()) return null;
    if (String(sessionRow.user_id) !== sub) return null;

    const user = await getUserById(sub);
    if (!user || !user.isActive) return null;

    // Use the DB role as source of truth (handles role changes after login).
    return {
      sub,
      email: user.email,
      role: user.role,
      jti,
      user: { ...user, role: user.role, email: user.email },
    };
  } catch {
    return null;
  }
}

export async function revokeSession(jti: string): Promise<void> {
  await ensureAuthSchema();
  await turso.execute({
    sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id = ?",
    args: [new Date().toISOString(), jti],
  });
}

export function sessionCookieAttributes(maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=__VALUE__; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function buildSessionCookie(token: string): string {
  return sessionCookieAttributes().replace("__VALUE__", token);
}

export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}
