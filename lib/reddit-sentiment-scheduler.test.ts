import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server.js";

test("allows only admins to refresh sentiment and avoids duplicate runs", async () => {
  const databasePath = `/private/tmp/reddit-sentiment-route-test-${process.pid}-${Date.now()}.db`;
  const previousDatabaseUrl = process.env.TURSO_DATABASE_URL;
  const previousDatabaseToken = process.env.TURSO_AUTH_TOKEN;
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousAdminEmails = process.env.ADMIN_EMAILS;
  process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  process.env.AUTH_SECRET = "test-auth-secret-at-least-32-characters";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const { POST } = await import("../app/api/admin/reddit-sentiment/route.ts");
  const { createSessionToken, findOrCreateUser, SESSION_COOKIE_NAME } = await import("./auth.ts");
  const { turso } = await import("./turso.ts");
  const globals = globalThis as Record<string, unknown>;
  const previousState = globals.__redditSentimentScheduler;

  try {
    const unauthorizedResponse = await POST(
      new NextRequest("http://localhost/api/admin/reddit-sentiment", { method: "POST" })
    );
    assert.equal(unauthorizedResponse.status, 403);
    assert.deepEqual(await unauthorizedResponse.json(), { error: "Admin access required." });

    const { user } = await findOrCreateUser("admin@example.com");
    const { token } = await createSessionToken(user);
    globals.__redditSentimentScheduler = {
      interval: null,
      child: null,
      running: true,
      cleanupRegistered: false,
      started: true,
      lastRunStatus: "running",
      lastRunMessage: "",
      lastStartedAt: "2026-09-30T12:00:00.000Z",
      lastFinishedAt: "",
    };
    const originalConsoleLog = console.log;
    console.log = () => {};

    try {
      const adminResponse = await POST(
        new NextRequest("http://localhost/api/admin/reddit-sentiment", {
          method: "POST",
          headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        })
      );
      const result = (await adminResponse.json()) as {
        started: boolean;
        running: boolean;
        lastRunStatus: string;
      };

      assert.equal(adminResponse.status, 202);
      assert.equal(result.started, false);
      assert.equal(result.running, true);
      assert.equal(result.lastRunStatus, "running");
    } finally {
      console.log = originalConsoleLog;
    }
  } finally {
    if (previousState === undefined) {
      delete globals.__redditSentimentScheduler;
    } else {
      globals.__redditSentimentScheduler = previousState;
    }
    if (previousAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousAuthSecret;
    }
    if (previousAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = previousAdminEmails;
    }
    turso.close();
    await unlink(databasePath).catch(() => {});
    if (previousDatabaseUrl === undefined) {
      delete process.env.TURSO_DATABASE_URL;
    } else {
      process.env.TURSO_DATABASE_URL = previousDatabaseUrl;
    }
    if (previousDatabaseToken === undefined) {
      delete process.env.TURSO_AUTH_TOKEN;
    } else {
      process.env.TURSO_AUTH_TOKEN = previousDatabaseToken;
    }
  }
});
