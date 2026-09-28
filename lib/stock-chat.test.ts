import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import test from "node:test";

test("persists isolated chat history and locks concurrent AI turns", async () => {
  const databasePath = `/private/tmp/stock-chat-test-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "test/chat-model";
  process.env.LLM_TIMEOUT_MS = "5000";

  const { ensureStockSchema, turso } = await import("./turso.ts");
  const {
    StockChatError,
    createChatSession,
    getChatNetworkHash,
    getChatVisitor,
    getChatSession,
    listChatSessions,
    readChatMessageInput,
    sendChatMessage,
    stockChatJson,
  } = await import("./stock-chat.ts");
  const { NextRequest } = await import("next/server.js");
  const originalFetch = globalThis.fetch;

  try {
    await ensureStockSchema();
    await turso.execute({
      sql: `
        INSERT INTO stock_history (
          fetched_at,
          symbol,
          name,
          price,
          price_text,
          change,
          change_text,
          change_percent,
          change_percent_text,
          previous_close_text,
          open_text,
          day_range_text,
          market_cap_text,
          volume_text,
          avg_volume_text,
          stats_json,
          source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        "2026-08-20T15:00:00.000Z",
        "TEST",
        "Test Corporation",
        101.5,
        "$101.50",
        1.5,
        "+1.50",
        1.5,
        "+1.50%",
        "$100.00",
        "$100.25",
        "$99.00 - $102.00",
        "$10B",
        "1.2M",
        "900K",
        '[{"label":"52 Week Range","value":"$70 - $110"}]',
        "https://finance.yahoo.com/quote/TEST/",
      ],
    });

    const visitorHash = "a".repeat(64);
    const otherVisitorHash = "b".repeat(64);
    const session = await createChatSession(
      visitorHash,
      "test-network",
      "test"
    );

    assert.equal(session.symbol, "TEST");
    assert.equal(session.status, "idle");
    assert.deepEqual(await listChatSessions(visitorHash, "TEST"), [session]);
    assert.deepEqual(await listChatSessions(otherVisitorHash, "TEST"), []);
    await assert.rejects(
      getChatSession(otherVisitorHash, "TEST", session.id),
      (error: unknown) =>
        error instanceof StockChatError &&
        error.status === 404 &&
        error.code === "session_not_found"
    );

    let releaseReply: (() => void) | undefined;
    let notifyRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    const replyReleased = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    let openRouterCallCount = 0;

    globalThis.fetch = (async (_input, init) => {
      openRouterCallCount += 1;
      const body = JSON.parse(String(init?.body)) as {
        messages?: { role?: string; content?: string }[];
      };
      const systemMessage = body.messages?.[0];

      assert.equal(systemMessage?.role, "system");
      assert.match(systemMessage?.content ?? "", /Test Corporation/);
      assert.match(systemMessage?.content ?? "", /STOCK_VIEW_DATA_START/);
      notifyRequestStarted?.();
      await replyReleased;

      return Response.json({
        id: "chat-response-1",
        model: "test/chat-model",
        choices: [
          {
            message: {
              content: "TEST is up 1.5% in the latest stored capture.",
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 12 },
      });
    }) as typeof fetch;

    const firstTurn = sendChatMessage(visitorHash, "test-network", "TEST", session.id, {
      turnId: "turn-first-0001",
      content: "What changed in the latest capture?",
    });
    await requestStarted;
    await assert.rejects(
      sendChatMessage(visitorHash, "test-network", "TEST", session.id, {
        turnId: "turn-second-0002",
        content: "Can I send this at the same time?",
      }),
      (error: unknown) =>
        error instanceof StockChatError &&
        error.status === 409 &&
        error.code === "chat_busy"
    );

    releaseReply?.();
    const completed = await firstTurn;

    assert.equal(completed.session.status, "idle");
    assert.equal(completed.userMessage.status, "completed");
    assert.equal(completed.assistantMessage.role, "assistant");
    assert.equal(completed.assistantMessage.status, "completed");
    assert.match(completed.assistantMessage.content, /up 1\.5%/);

    const repeated = await sendChatMessage(visitorHash, "test-network", "TEST", session.id, {
      turnId: "turn-first-0001",
      content: "What changed in the latest capture?",
    });
    assert.equal(repeated.userMessage.id, completed.userMessage.id);
    assert.equal(repeated.assistantMessage.id, completed.assistantMessage.id);
    assert.equal(openRouterCallCount, 1);

    const history = await getChatSession(visitorHash, "TEST", session.id);
    assert.equal(history.session.messageCount, 2);
    assert.equal(history.session.title, "What changed in the latest capture?");
    assert.deepEqual(
      history.messages.map(({ role, status }) => ({ role, status })),
      [
        { role: "user", status: "completed" },
        { role: "assistant", status: "completed" },
      ]
    );

    globalThis.fetch = (async () => {
      throw new Error("simulated provider outage");
    }) as typeof fetch;
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      await assert.rejects(
        sendChatMessage(
          visitorHash,
          "test-network",
          "TEST",
          session.id,
          {
            turnId: "turn-failed-0003",
            content: "This request should record a failed reply.",
          }
        ),
        (error: unknown) =>
          error instanceof StockChatError &&
          error.status === 502 &&
          error.code === "ai_request_failed" &&
          error.details?.session.status === "idle" &&
          error.details.assistantMessage.status === "failed"
      );
    } finally {
      console.error = originalConsoleError;
    }
    const failedHistory = await getChatSession(
      visitorHash,
      "TEST",
      session.id
    );
    assert.equal(failedHistory.session.status, "idle");
    assert.deepEqual(
      failedHistory.messages.slice(-2).map(({ role, status }) => ({
        role,
        status,
      })),
      [
        { role: "user", status: "completed" },
        { role: "assistant", status: "failed" },
      ]
    );

    const firstVisitor = getChatVisitor(
      new NextRequest("http://localhost/api/stocks/TEST/chat/sessions")
    );
    const cookieResponse = stockChatJson(firstVisitor, { ok: true });
    const cookieValue = cookieResponse.headers
      .get("set-cookie")
      ?.match(/stock_chat_visitor=([^;]+)/)?.[1];

    assert.ok(cookieValue);
    const returningVisitor = getChatVisitor(
      new NextRequest("http://localhost/api/stocks/TEST/chat/sessions", {
        headers: { cookie: `stock_chat_visitor=${cookieValue}` },
      })
    );
    assert.equal(returningVisitor.visitorHash, firstVisitor.visitorHash);
    assert.equal(returningVisitor.newCookieValue, null);

    const forwardedRequest = new NextRequest(
      "http://localhost/api/stocks/TEST/chat/sessions",
      { headers: { "x-forwarded-for": "203.0.113.42" } }
    );
    assert.equal(getChatNetworkHash(forwardedRequest), null);
    process.env.STOCK_CHAT_TRUST_PROXY_HEADERS = "true";
    assert.match(getChatNetworkHash(forwardedRequest) ?? "", /^[a-f0-9]{64}$/);
    delete process.env.STOCK_CHAT_TRUST_PROXY_HEADERS;

    const oversizedRequest = new NextRequest(
      "http://localhost/api/stocks/TEST/chat/sessions/example/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x".repeat(25_000) }),
      }
    );
    await assert.rejects(
      readChatMessageInput(oversizedRequest),
      (error: unknown) =>
        error instanceof StockChatError &&
        error.status === 413 &&
        error.code === "message_too_large"
    );
  } finally {
    globalThis.fetch = originalFetch;
    turso.close();
    await unlink(databasePath).catch(() => {});
  }
});
