import type { Client, ResultSet, Transaction } from "@libsql/client";
import { readFileSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  REDDIT_KEYWORDS,
  parsePuppeteerRedditPosts,
  parseRedditSentiment,
  type RedditKeyword,
  type RedditPost,
} from "./lib/reddit-core.ts";
import { ensureStockSchema, turso } from "./lib/turso.ts";

type RedditConfig = {
  timeoutMs: number;
};

type RedditPageSnapshot = {
  rawPosts: unknown[];
  maxFeedIndex: number;
  scrollHeight: number;
};

type LlmConfig = {
  provider: "openrouter";
  model: string;
  apiKey: string;
  endpoint: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

type LlmResult = {
  responseId: string;
  model: string;
  analysisText: string;
  rawResponseJson: string;
  usageJson: string;
};

type StoredRedditPost = RedditPost & {
  databaseId: number;
};

type AnalysisBatch = {
  posts: StoredRedditPost[];
  periodStart: string;
  periodEnd: string;
  keywords: string[];
  claimToken: string;
};

type ClaimedPostRow = {
  id: number;
  reddit_post_id: string;
  subreddit: string;
  title: string;
  author: string;
  posted_at: string;
  body_text: string;
  source_url: string;
  matched_keywords_json: string;
};

type RedditPollBoundary = {
  postId: string;
  postedAt: string;
};

const redditListingUrl = "https://www.reddit.com/r/wallstreetbets/new/";
const redditPostSelector = 'shreddit-post[id^="t3_"]';
const redditChromeUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const redditPromptPath = "./prompts/reddit-sentiment.md";
const analysisBatchSize = 25;
const maxAnalysisBatchesPerRun = 4;
const maxAnalysisAttempts = 3;
const initialRedditPostTarget = 100;
const maxRedditScrollAttempts = 50;
const maxStagnantScrollAttempts = 2;
const processingLeaseMs = 15 * 60_000;
const failureRetryMs = 5 * 60_000;
const postBodyExcerptChars = 2_000;

function optionalEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const value = optionalEnv(name);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Env var ${name} must be a positive integer.`);
  }

  return parsed;
}

function buildEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function getRedditConfig(): RedditConfig {
  return {
    timeoutMs: parsePositiveIntegerEnv("REDDIT_TIMEOUT_MS", 60_000),
  };
}

function getLlmConfig(): LlmConfig | null {
  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  const model = optionalEnv("OPENROUTER_MODEL");

  if (!apiKey && !model) {
    return null;
  }

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY for Reddit sentiment analysis.");
  }

  if (!model) {
    throw new Error("Missing OPENROUTER_MODEL for Reddit sentiment analysis.");
  }

  return {
    provider: "openrouter",
    model,
    apiKey,
    endpoint: buildEndpoint(
      optionalEnv("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
      "/chat/completions"
    ),
    maxOutputTokens: parsePositiveIntegerEnv("LLM_MAX_OUTPUT_TOKENS", 1200),
    timeoutMs: parsePositiveIntegerEnv("LLM_TIMEOUT_MS", 60_000),
  };
}

function log(message: string): void {
  console.log(`[reddit-sentiment] [${new Date().toISOString()}] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value)) {
    return "";
  }

  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : "";
}

function jsonField(value: unknown, field: string): string {
  if (!isRecord(value) || value[field] === undefined) {
    return "{}";
  }

  return JSON.stringify(value[field]);
}

function responseError(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }

  const error = data.error;

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return typeof data.message === "string" ? data.message : "";
}

async function readJsonResponse(
  response: Response,
  requestName: string
): Promise<unknown> {
  const text = await response.text();
  let data: unknown;

  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(
      `${requestName} returned non-JSON content (${response.status}): ${text.slice(0, 300)}`
    );
  }

  if (!response.ok) {
    const message = responseError(data) || text.slice(0, 500);
    throw new Error(`${requestName} failed (${response.status}): ${message}`);
  }

  return data;
}

async function readRedditPageSnapshot(
  page: Page
): Promise<RedditPageSnapshot> {
  return page.evaluate((selector): RedditPageSnapshot => {
    const cards = Array.from(document.querySelectorAll(selector));
    const rawPosts = cards.map((card) => ({
      redditPostId: card.getAttribute("id") || "",
      subreddit: card.getAttribute("subreddit-name") || "",
      title:
        card.getAttribute("post-title") ||
        card.querySelector('[slot="title"]')?.textContent?.trim() ||
        "",
      author: card.getAttribute("author") || "",
      postedAt:
        card.getAttribute("created-timestamp") ||
        card.querySelector("faceplate-timeago")?.getAttribute("ts") ||
        card.querySelector("time")?.getAttribute("datetime") ||
        "",
      sourceUrl: card.getAttribute("permalink") || "",
      bodyText:
        card
          .querySelector(
            'shreddit-post-text-body[slot="text-body"] [property="schema:articleBody"]'
          )
          ?.textContent?.trim() || "",
      isStickied:
        card.hasAttribute("stickied") || card.hasAttribute("is-stickied"),
    }));
    const maxFeedIndex = cards.reduce((maximum, card) => {
      const value = Number(card.getAttribute("feedindex"));
      return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, -1);

    return {
      rawPosts,
      maxFeedIndex,
      scrollHeight: document.documentElement.scrollHeight,
    };
  }, redditPostSelector);
}

function isRedditListingPage(urlValue: string): boolean {
  const url = new URL(urlValue);
  const hostname = url.hostname.toLowerCase();
  const isRedditHost =
    hostname === "reddit.com" || hostname.endsWith(".reddit.com");

  return (
    url.protocol === "https:" &&
    isRedditHost &&
    /^\/r\/wallstreetbets\/new\/?$/i.test(url.pathname)
  );
}

async function openRedditListingPage(
  page: Page,
  config: RedditConfig
): Promise<void> {
  const response = await page.goto(redditListingUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs,
  });

  if (!response || !response.ok()) {
    throw new Error(
      `Reddit page request failed (${response?.status() ?? "no response"}).`
    );
  }

  if (!isRedditListingPage(page.url())) {
    throw new Error(`Reddit redirected Puppeteer to an unexpected URL: ${page.url()}`);
  }

  try {
    await page.waitForSelector(redditPostSelector, {
      timeout: config.timeoutMs,
    });
  } catch (error: unknown) {
    const pageText = await page.evaluate(
      () => `${document.title}\n${document.body?.innerText || ""}`.slice(0, 2_000)
    );
    const blocked = [
      "you've been blocked",
      "network security",
      "request has been blocked",
      "whoa there",
      "prove you are human",
      "verify you are human",
      "something went wrong",
    ].some((phrase) => pageText.toLowerCase().includes(phrase));

    if (blocked) {
      throw new Error(
        `Reddit blocked the Puppeteer page before posts rendered: ${pageText
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300)}`
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Reddit posts did not render in Puppeteer: ${message}`);
  }
}

async function waitForRedditFeedAdvance(
  page: Page,
  knownPostIds: string[],
  previousSnapshot: RedditPageSnapshot,
  timeoutMs: number
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (
        selector,
        knownIds,
        previousFeedIndex,
        previousScrollHeight
      ) => {
        const known = new Set(knownIds);
        const cards = Array.from(document.querySelectorAll(selector));
        const hasUnseenPost = cards.some((card) => {
          const postId = card.getAttribute("id")?.replace(/^t3_/i, "") || "";
          return postId !== "" && !known.has(postId);
        });
        const maxFeedIndex = cards.reduce((maximum, card) => {
          const value = Number(card.getAttribute("feedindex"));
          return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
        }, -1);

        return (
          hasUnseenPost ||
          maxFeedIndex > previousFeedIndex ||
          document.documentElement.scrollHeight > previousScrollHeight
        );
      },
      { polling: 250, timeout: Math.min(timeoutMs, 15_000) },
      redditPostSelector,
      knownPostIds,
      previousSnapshot.maxFeedIndex,
      previousSnapshot.scrollHeight
    );
    return true;
  } catch {
    return false;
  }
}

async function scrollRedditFeed(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const cards = document.querySelectorAll(selector);
    cards.item(cards.length - 1)?.scrollIntoView({ block: "end" });
    window.scrollTo(0, document.documentElement.scrollHeight);
  }, redditPostSelector);
}

async function getRedditPollBoundary(
  db: Client
): Promise<RedditPollBoundary | null> {
  const result = await db.execute(`
    SELECT last_seen_post_id, last_seen_posted_at
    FROM reddit_monitor_state
    WHERE id = 1
  `);
  const row = result.rows[0] as
    | { last_seen_post_id?: unknown; last_seen_posted_at?: unknown }
    | undefined;

  if (
    typeof row?.last_seen_post_id !== "string" ||
    !row.last_seen_post_id.trim() ||
    typeof row.last_seen_posted_at !== "string" ||
    !row.last_seen_posted_at.trim() ||
    Number.isNaN(Date.parse(row.last_seen_posted_at))
  ) {
    return null;
  }

  return {
    postId: row.last_seen_post_id,
    postedAt: row.last_seen_posted_at,
  };
}

async function storeRedditPollBoundary(
  db: Client,
  boundary: RedditPollBoundary | null
): Promise<void> {
  if (!boundary?.postId || !boundary.postedAt) {
    return;
  }

  await db.execute({
    sql: `
      INSERT INTO reddit_monitor_state (
        id,
        last_seen_post_id,
        last_seen_posted_at,
        updated_at
      ) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen_post_id = excluded.last_seen_post_id,
        last_seen_posted_at = excluded.last_seen_posted_at,
        updated_at = excluded.updated_at
      WHERE reddit_monitor_state.last_seen_posted_at <= excluded.last_seen_posted_at
    `,
    args: [boundary.postId, boundary.postedAt, new Date().toISOString()],
  });
}

async function getNewWallStreetBetsPosts(
  db: Client,
  page: Page,
  config: RedditConfig
): Promise<{ posts: RedditPost[]; newestBoundary: RedditPollBoundary | null }> {
  const previousBoundary = await getRedditPollBoundary(db);
  const postsById = new Map<string, RedditPost>();
  let scrollAttempts = 0;
  let stagnantScrollAttempts = 0;

  await openRedditListingPage(page, config);

  let snapshot = await readRedditPageSnapshot(page);

  for (const post of parsePuppeteerRedditPosts(snapshot.rawPosts)) {
    postsById.set(post.redditPostId, post);
  }

  const reachedPreviousTimestamp = (): boolean =>
    previousBoundary !== null &&
    Array.from(postsById.values()).some(
      (post) =>
        !post.isStickied && post.postedAt < previousBoundary.postedAt
    );

  while (
    scrollAttempts < maxRedditScrollAttempts &&
    stagnantScrollAttempts < maxStagnantScrollAttempts &&
    (previousBoundary
      ? !reachedPreviousTimestamp()
      : postsById.size < initialRedditPostTarget)
  ) {
    const knownPostIds = Array.from(postsById.keys());
    const previousSnapshot = snapshot;

    await scrollRedditFeed(page);
    const advanced = await waitForRedditFeedAdvance(
      page,
      knownPostIds,
      previousSnapshot,
      config.timeoutMs
    );

    if (advanced) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    snapshot = await readRedditPageSnapshot(page);
    const postCountBefore = postsById.size;

    for (const post of parsePuppeteerRedditPosts(snapshot.rawPosts)) {
      postsById.set(post.redditPostId, post);
    }

    const snapshotAdvanced =
      postsById.size > postCountBefore ||
      snapshot.maxFeedIndex > previousSnapshot.maxFeedIndex ||
      snapshot.scrollHeight > previousSnapshot.scrollHeight;

    stagnantScrollAttempts = snapshotAdvanced
      ? 0
      : stagnantScrollAttempts + 1;
    scrollAttempts += 1;
  }

  if (previousBoundary && !reachedPreviousTimestamp()) {
    throw new Error(
      `Puppeteer could not scroll past Reddit boundary ${previousBoundary.postId} ` +
        `after ${scrollAttempts} attempt(s); the poll boundary was not advanced.`
    );
  }

  if (!previousBoundary && postsById.size < initialRedditPostTarget) {
    throw new Error(
      `Puppeteer collected only ${postsById.size}/${initialRedditPostTarget} ` +
        `posts for the initial Reddit baseline; the poll boundary was not advanced.`
    );
  }

  const regularPosts = Array.from(postsById.values()).filter(
    (post) => !post.isStickied
  );
  const newestPost = [...regularPosts].sort((left, right) =>
    right.postedAt.localeCompare(left.postedAt)
  )[0];
  const newestBoundary = newestPost
    ? { postId: newestPost.redditPostId, postedAt: newestPost.postedAt }
    : null;
  const newPosts = previousBoundary
    ? regularPosts.filter(
        (post) =>
          post.redditPostId !== previousBoundary.postId &&
          post.postedAt >= previousBoundary.postedAt
      )
    : regularPosts;

  log(
    `Validated ${postsById.size} rendered Reddit post(s) after ${scrollAttempts} scroll(s)${
      previousBoundary
        ? ` from boundary ${previousBoundary.postId}`
        : " for initial baseline"
    }.`
  );

  return {
    posts: newPosts,
    newestBoundary,
  };
}

async function collectNewWallStreetBetsPosts(
  db: Client,
  config: RedditConfig
): Promise<{ posts: RedditPost[]; newestBoundary: RedditPollBoundary | null }> {
  let browser: Browser | undefined;

  try {
    log("Launching Puppeteer for Reddit.");
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: await puppeteer.executablePath({ headless: "shell" }),
      headless: "shell",
    });
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(redditChromeUserAgent);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

    return await getNewWallStreetBetsPosts(db, page, config);
  } finally {
    if (browser) {
      await browser.close();
      log("Closed Puppeteer after Reddit collection.");
    }
  }
}

function collectTextBlocks(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectTextBlocks);
  }

  if (!isRecord(value)) {
    return [];
  }

  const text = typeof value.text === "string" ? [value.text] : [];
  return text.concat(collectTextBlocks(value.content));
}

function extractOpenRouterText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }

  if (!Array.isArray(data.choices)) {
    return collectTextBlocks(data.output).join("\n").trim();
  }

  return data.choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.message)) {
        return "";
      }

      const content = choice.message.content;
      return typeof content === "string"
        ? content
        : collectTextBlocks(content).join("\n");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function runLlmAnalysis(
  config: LlmConfig,
  prompt: string
): Promise<LlmResult> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.maxOutputTokens,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const data = await readJsonResponse(response, "OpenRouter request");
  const analysisText = extractOpenRouterText(data);

  if (!analysisText) {
    throw new Error("OpenRouter response did not include text output.");
  }

  return {
    responseId: stringField(data, "id"),
    model: stringField(data, "model") || config.model,
    analysisText,
    rawResponseJson: JSON.stringify(data),
    usageJson: jsonField(data, "usage"),
  };
}

function buildSentimentPrompt(
  instructions: string,
  posts: StoredRedditPost[]
): string {
  const payload = posts.map((post) => ({
    reddit_post_id: post.redditPostId,
    title: post.title,
    author: post.author,
    posted_at: post.postedAt,
    matched_keywords: post.matchedKeywords,
    body_excerpt: post.bodyText.slice(0, postBodyExcerptChars),
    source_url: post.sourceUrl,
  }));

  return `${instructions}\n\nInput posts JSON:\n${JSON.stringify(payload, null, 2)}`;
}

function lastInsertRowId(result: ResultSet, tableName: string): number {
  const value = result.lastInsertRowid;

  if (value === undefined || value === null) {
    throw new Error(`Database did not return an id for ${tableName}.`);
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    throw new Error(`Database returned an invalid id for ${tableName}.`);
  }

  return id;
}

async function storeNewPosts(
  db: Client,
  posts: RedditPost[]
): Promise<number> {
  const discoveredAt = new Date().toISOString();
  let insertedCount = 0;

  for (const post of posts) {
    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO reddit_posts (
          reddit_post_id,
          discovered_at,
          posted_at,
          subreddit,
          title,
          author,
          body_text,
          source_url,
          matched_keywords_json,
          analysis_status,
          analysis_attempt_count,
          analysis_started_at,
          sentiment_analysis_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', 0)
      `,
      args: [
        post.redditPostId,
        discoveredAt,
        post.postedAt,
        post.subreddit,
        post.title,
        post.author,
        post.bodyText,
        post.sourceUrl,
        JSON.stringify(post.matchedKeywords),
      ],
    });

    if (result.rowsAffected > 0) {
      insertedCount += 1;
    }
  }

  return insertedCount;
}

function makeAnalysisBatch(
  posts: StoredRedditPost[],
  claimToken: string
): AnalysisBatch {
  const postedAt = posts.map((post) => post.postedAt).sort();
  const keywords = REDDIT_KEYWORDS.filter((keyword) =>
    posts.some((post) => post.matchedKeywords.includes(keyword))
  );

  return {
    posts,
    periodStart: postedAt[0] ?? new Date().toISOString(),
    periodEnd: postedAt.at(-1) ?? new Date().toISOString(),
    keywords,
    claimToken,
  };
}

function parseStoredKeywords(value: string): RedditKeyword[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored Reddit matched_keywords_json was invalid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.some((keyword) => typeof keyword !== "string")) {
    throw new Error("Stored Reddit matched_keywords_json must be an array of strings.");
  }

  return REDDIT_KEYWORDS.filter((keyword) => parsed.includes(keyword));
}

async function claimNextAnalysisBatch(db: Client): Promise<AnalysisBatch | null> {
  const now = new Date();
  const claimToken = now.toISOString();
  const leaseCutoff = new Date(now.getTime() - processingLeaseMs).toISOString();
  const retryCutoff = new Date(now.getTime() - failureRetryMs).toISOString();
  const exhaustedResult = await db.execute({
    sql: `
      UPDATE reddit_posts
      SET analysis_status = 'failed', analysis_started_at = ?
      WHERE analysis_status = 'processing'
        AND analysis_attempt_count >= ?
        AND analysis_started_at <= ?
    `,
    args: [claimToken, maxAnalysisAttempts, leaseCutoff],
  });

  if (exhaustedResult.rowsAffected > 0) {
    log(
      `Moved ${exhaustedResult.rowsAffected} exhausted Reddit analysis queue row(s) to failed.`
    );
  }

  const result = await db.execute({
    sql: `
      UPDATE reddit_posts
      SET
        analysis_status = 'processing',
        analysis_attempt_count = analysis_attempt_count + 1,
        analysis_started_at = ?
      WHERE id IN (
        SELECT id
        FROM reddit_posts
        WHERE
          analysis_status = 'pending'
          OR (
            analysis_status = 'processing'
            AND analysis_attempt_count < ?
            AND analysis_started_at <= ?
          )
          OR (
            analysis_status = 'failed'
            AND analysis_attempt_count < ?
            AND analysis_started_at <= ?
          )
        ORDER BY posted_at ASC, id ASC
        LIMIT ?
      )
      RETURNING
        id,
        reddit_post_id,
        subreddit,
        title,
        author,
        posted_at,
        body_text,
        source_url,
        matched_keywords_json
    `,
    args: [
      claimToken,
      maxAnalysisAttempts,
      leaseCutoff,
      maxAnalysisAttempts,
      retryCutoff,
      analysisBatchSize,
    ],
  });
  const rows = result.rows as unknown as ClaimedPostRow[];

  if (rows.length === 0) {
    return null;
  }

  const posts = rows
    .map((row): StoredRedditPost => {
      if (row.subreddit !== "wallstreetbets") {
        throw new Error(`Stored Reddit post ${row.id} had an unexpected subreddit.`);
      }

      return {
        databaseId: Number(row.id),
        redditPostId: row.reddit_post_id,
        subreddit: "wallstreetbets",
        title: row.title,
        author: row.author,
        postedAt: row.posted_at,
        bodyText: row.body_text,
        sourceUrl: row.source_url,
        isStickied: false,
        matchedKeywords: parseStoredKeywords(row.matched_keywords_json),
      };
    })
    .sort((left, right) => left.postedAt.localeCompare(right.postedAt));

  return makeAnalysisBatch(posts, claimToken);
}

async function storeCompletedAnalysis(
  db: Transaction,
  batch: AnalysisBatch,
  config: LlmConfig,
  promptText: string,
  llmResult: LlmResult
): Promise<number> {
  const sentiment = parseRedditSentiment(llmResult.analysisText);
  const result = await db.execute({
    sql: `
      INSERT INTO reddit_sentiment_analyses (
        created_at,
        period_start,
        period_end,
        post_count,
        post_ids_json,
        keywords_json,
        provider,
        model,
        status,
        overall_sentiment,
        summary_text,
        trends_json,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      new Date().toISOString(),
      batch.periodStart,
      batch.periodEnd,
      batch.posts.length,
      JSON.stringify(batch.posts.map((post) => post.redditPostId)),
      JSON.stringify(batch.keywords),
      config.provider,
      llmResult.model,
      "completed",
      sentiment.overallSentiment,
      sentiment.summary,
      JSON.stringify(sentiment.trends),
      redditPromptPath,
      promptText,
      promptText.length,
      llmResult.analysisText.length,
      llmResult.analysisText,
      "",
      llmResult.responseId,
      llmResult.usageJson,
      llmResult.rawResponseJson,
    ],
  });

  return lastInsertRowId(result, "reddit_sentiment_analyses");
}

async function storeFailedAnalysis(
  db: Transaction,
  batch: AnalysisBatch,
  config: LlmConfig,
  promptText: string,
  error: unknown,
  llmResult: LlmResult | null
): Promise<void> {
  const errorText = error instanceof Error ? error.message : String(error);

  await db.execute({
    sql: `
      INSERT INTO reddit_sentiment_analyses (
        created_at,
        period_start,
        period_end,
        post_count,
        post_ids_json,
        keywords_json,
        provider,
        model,
        status,
        overall_sentiment,
        summary_text,
        trends_json,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      new Date().toISOString(),
      batch.periodStart,
      batch.periodEnd,
      batch.posts.length,
      JSON.stringify(batch.posts.map((post) => post.redditPostId)),
      JSON.stringify(batch.keywords),
      config.provider,
      llmResult?.model || config.model,
      "failed",
      "",
      "",
      "[]",
      redditPromptPath,
      promptText,
      promptText.length,
      llmResult?.analysisText.length ?? 0,
      llmResult?.analysisText ?? "",
      errorText,
      llmResult?.responseId ?? "",
      llmResult?.usageJson ?? "{}",
      llmResult?.rawResponseJson ?? "{}",
    ],
  });
}

async function markBatch(
  db: Transaction,
  batch: AnalysisBatch,
  status: "completed" | "failed",
  analysisId: number
): Promise<void> {
  const placeholders = batch.posts.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `
      UPDATE reddit_posts
      SET
        analysis_status = ?,
        analysis_started_at = ?,
        sentiment_analysis_id = ?
      WHERE analysis_status = 'processing'
        AND analysis_started_at = ?
        AND id IN (${placeholders})
    `,
    args: [
      status,
      new Date().toISOString(),
      analysisId,
      batch.claimToken,
      ...batch.posts.map((post) => post.databaseId),
    ],
  });

  if (result.rowsAffected !== batch.posts.length) {
    throw new Error(
      `Updated ${result.rowsAffected}/${batch.posts.length} Reddit analysis queue rows.`
    );
  }
}

async function completeBatch(
  db: Client,
  batch: AnalysisBatch,
  config: LlmConfig,
  promptText: string,
  llmResult: LlmResult
): Promise<number> {
  const transaction = await db.transaction("write");

  try {
    const analysisId = await storeCompletedAnalysis(
      transaction,
      batch,
      config,
      promptText,
      llmResult
    );
    await markBatch(transaction, batch, "completed", analysisId);
    await transaction.commit();
    return analysisId;
  } finally {
    transaction.close();
  }
}

async function failBatch(
  db: Client,
  batch: AnalysisBatch,
  config: LlmConfig,
  promptText: string,
  error: unknown,
  llmResult: LlmResult | null
): Promise<void> {
  const transaction = await db.transaction("write");

  try {
    await storeFailedAnalysis(
      transaction,
      batch,
      config,
      promptText,
      error,
      llmResult
    );
    await markBatch(transaction, batch, "failed", 0);
    await transaction.commit();
  } finally {
    transaction.close();
  }
}

async function analyzePendingPosts(
  db: Client,
  config: LlmConfig
): Promise<void> {
  const instructions = readFileSync(redditPromptPath, "utf8").trim();
  let failedBatches = 0;
  let processedBatches = 0;

  for (let index = 0; index < maxAnalysisBatchesPerRun; index += 1) {
    const batch = await claimNextAnalysisBatch(db);

    if (!batch) {
      break;
    }

    processedBatches += 1;
    const promptText = buildSentimentPrompt(instructions, batch.posts);
    let llmResult: LlmResult | null = null;
    let analysisId: number | null = null;

    try {
      llmResult = await runLlmAnalysis(config, promptText);
      analysisId = await completeBatch(
        db,
        batch,
        config,
        promptText,
        llmResult
      );
    } catch (error: unknown) {
      failedBatches += 1;
      await failBatch(db, batch, config, promptText, error, llmResult);
      const message = error instanceof Error ? error.message : String(error);
      log(`Sentiment batch ${index + 1} failed: ${message}`);
      continue;
    }

    log(`Stored sentiment analysis ${analysisId} for batch ${index + 1}.`);
  }

  if (processedBatches === 0) {
    log("No pending matching posts require sentiment analysis.");
  }

  if (failedBatches > 0) {
    throw new Error(`${failedBatches} Reddit sentiment batch(es) failed.`);
  }
}

async function main(): Promise<void> {
  const errors: string[] = [];
  let redditConfig: RedditConfig | null = null;
  let llmConfig: LlmConfig | null = null;

  try {
    redditConfig = getRedditConfig();
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    llmConfig = getLlmConfig();
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  await ensureStockSchema();

  if (redditConfig) {
    try {
      const { posts, newestBoundary } = await collectNewWallStreetBetsPosts(
        turso,
        redditConfig
      );
      const matchingPosts = posts.filter(
        (post) => post.matchedKeywords.length > 0
      );
      const newPostCount = await storeNewPosts(turso, matchingPosts);
      await storeRedditPollBoundary(turso, newestBoundary);

      log(
        `Validated ${posts.length} new posts; ${matchingPosts.length} matched keywords; ${newPostCount} were stored.`
      );
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (llmConfig) {
    try {
      await analyzePendingPosts(turso, llmConfig);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    log(
      "Left matching posts pending because OpenRouter is not configured."
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[reddit-sentiment] ${message}`);
  process.exitCode = 1;
});
