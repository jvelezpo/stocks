import puppeteer, { type Browser, type Page } from "puppeteer";
import type { Client, ResultSet } from "@libsql/client";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ensureStockSchema, turso } from "./lib/turso.ts";

type QuoteStat = {
  label: string;
  value: string;
};

type Quote = {
  name: string;
  price: string;
  change: string;
  changePercent: string;
  stats: QuoteStat[];
};

type LlmConfig = {
  provider: "openrouter";
  model: string;
  apiKey: string;
  endpoint: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

type PageDocument = {
  title: string;
  bodyText: string;
  bodyCharCount: number;
  wasTruncated: boolean;
};

type LlmResult = {
  responseId: string;
  model: string;
  analysisText: string;
  rawResponseJson: string;
  usageJson: string;
};

const promptPath = "./prompts/prompt.md";
const hftPromptPath = "./prompts/hft.md";
const llmAnalysisCooldownMs = 5 * 60 * 60 * 1000; // 5 hours
const hftAnalysisCooldownMs = 20 * 60 * 1000; // 20 minutes

type RowId = number | bigint;

type LatestAnalysisRun = {
  created_at: string;
  status: string;
  provider: string;
  model: string;
};

type HftHistoryRow = {
  id: number;
  fetched_at: string;
  symbol: string;
  name: string;
  price: number;
  price_text: string;
  change: number | null;
  change_text: string;
  change_percent: number | null;
  change_percent_text: string;
  previous_close_text: string;
  open_text: string;
  day_range_text: string;
  market_cap_text: string;
  volume_text: string;
  avg_volume_text: string;
};

type HftParsedResult = {
  decision: string;
  confidence: number | null;
  marketRegime: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var ${name}. Add ${name}=IONQ,NVDA to .env.`);
  }

  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function parseSymbolsEnv(): string[] {
  const value = requiredEnv("SYMBOLS");
  const symbols = value.startsWith("[")
    ? parseSymbolsJson(value)
    : value.split(",");
  const normalizedSymbols = symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const uniqueSymbols = Array.from(new Set(normalizedSymbols));

  if (uniqueSymbols.length === 0) {
    throw new Error("Env var SYMBOLS must include at least one symbol.");
  }

  return uniqueSymbols;
}

function parseSymbolsJson(value: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(
      'Env var SYMBOLS must be a comma-separated list or a JSON array like ["IONQ","NVDA"].'
    );
  }

  if (!Array.isArray(parsed) || parsed.some((symbol) => typeof symbol !== "string")) {
    throw new Error("Env var SYMBOLS JSON value must be an array of strings.");
  }

  return parsed;
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

function getLlmConfig(): LlmConfig | null {
  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  const model = optionalEnv("OPENROUTER_MODEL");

  if (!apiKey && !model) {
    return null;
  }

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY for LLM analysis.");
  }

  if (!model) {
    throw new Error("Missing OPENROUTER_MODEL for LLM analysis.");
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
    timeoutMs: parsePositiveIntegerEnv("LLM_TIMEOUT_MS", 60000),
  };
}

function quoteUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;
}

function parseNumber(value: string): number | null {
  const normalized = value.replace(/[,%()+]/g, "").trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function statValue(quote: Quote, label: string): string {
  return quote.stats.find((stat) => stat.label === label)?.value || "";
}

function elapsedSince(startTime: number): string {
  return `${((performance.now() - startTime) / 1000).toFixed(2)}s`;
}

function formatDuration(ms: number): string {
  const hours = ms / (60 * 60 * 1000);

  return `${hours.toFixed(2)}h`;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function runAppleScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve();
    });
  });
}

function showNotification(
  title: string,
  subtitle: string,
  message: string
): Promise<void> {
  const script = [
    `display notification "${escapeAppleScript(message)}"`,
    `with title "${escapeAppleScript(title)}"`,
    `subtitle "${escapeAppleScript(subtitle)}"`,
    'sound name "Glass"',
  ].join(" ");

  return runAppleScript(script);
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

function llmErrorMessage(data: unknown): string {
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

  if (typeof data.message === "string") {
    return data.message;
  }

  return "";
}

async function postJson(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data: unknown = {};

  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { text };
    }
  }

  if (!response.ok) {
    const message = llmErrorMessage(data) || text.slice(0, 500);
    throw new Error(`LLM request failed (${response.status}): ${message}`);
  }

  return data;
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
  const data = await postJson(
    config.endpoint,
    { authorization: `Bearer ${config.apiKey}` },
    {
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.maxOutputTokens,
    },
    config.timeoutMs
  );
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

function readPrompt(path: string): string {
  return readFileSync(path, "utf8").trim();
}

function readAnalysisPrompt(): string {
  return readPrompt(promptPath);
}

function readHftPrompt(): string {
  return readPrompt(hftPromptPath);
}

function buildAnalysisPrompt(prompt: string, documentText: string): string {
  return `${prompt}\n\n${documentText}`;
}

function buildHftPrompt(
  prompt: string,
  symbol: string,
  document: PageDocument,
  historyRows: HftHistoryRow[]
): string {
  const payload = {
    instrument: symbol,
    timestamp: new Date().toISOString(),
    timeframe: "latest 60 captured quote snapshots",
    website_data: {
      title: document.title,
      body_text: document.bodyText,
      body_char_count: document.bodyCharCount,
      was_truncated: document.wasTruncated,
    },
    stock_history_last_60: historyRows.map((row) => ({
      id: row.id,
      fetched_at: row.fetched_at,
      symbol: row.symbol,
      name: row.name,
      price: row.price,
      price_text: row.price_text,
      change: row.change,
      change_text: row.change_text,
      change_percent: row.change_percent,
      change_percent_text: row.change_percent_text,
      previous_close_text: row.previous_close_text,
      open_text: row.open_text,
      day_range_text: row.day_range_text,
      market_cap_text: row.market_cap_text,
      volume_text: row.volume_text,
      avg_volume_text: row.avg_volume_text,
    })),
  };

  return `${prompt}\n\nInput data JSON:\n${JSON.stringify(payload, null, 2)}`;
}

function extractRecommendation(analysisText: string): string {
  const recommendationMatch =
    analysisText.match(/Recommendation:\s*\*{0,2}(BUY|SELL|HOLD)\*{0,2}/i) ||
    analysisText.match(/\b(BUY|SELL|HOLD)\b/i);

  return recommendationMatch?.[1]?.toUpperCase() || "";
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    }

    throw new Error("HFT analysis output was not valid JSON.");
  }
}

function parseHftResult(analysisText: string): HftParsedResult {
  const parsed = extractJsonObject(analysisText);

  if (!isRecord(parsed)) {
    throw new Error("HFT analysis JSON must be an object.");
  }

  const decision = stringField(parsed, "decision").toUpperCase();
  const confidenceValue = parsed.confidence;
  const marketRegime = stringField(parsed, "market_regime");

  return {
    decision: ["BUY", "SELL", "HOLD"].includes(decision) ? decision : "",
    confidence:
      typeof confidenceValue === "number" && Number.isFinite(confidenceValue)
        ? confidenceValue
        : null,
    marketRegime,
  };
}

async function connectDatabase(): Promise<Client> {
  await ensureStockSchema();

  return turso;
}

function lastInsertRowId(result: ResultSet, tableName: string): bigint {
  if (result.lastInsertRowid === undefined) {
    throw new Error(`Turso did not return a row id for ${tableName}.`);
  }

  return result.lastInsertRowid;
}

async function storeQuoteHistory(
  db: Client,
  symbol: string,
  url: string,
  quote: Quote
): Promise<bigint> {
  const price = parseNumber(quote.price);

  if (price === null) {
    throw new Error(`Could not parse current price "${quote.price}".`);
  }

  const result = await db.execute({
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
      new Date().toISOString(),
      symbol,
      quote.name,
      price,
      quote.price,
      parseNumber(quote.change),
      quote.change,
      parseNumber(quote.changePercent),
      quote.changePercent,
      statValue(quote, "Previous Close"),
      statValue(quote, "Open"),
      statValue(quote, "Day's Range"),
      statValue(quote, "Market Cap"),
      statValue(quote, "Volume"),
      statValue(quote, "Avg. Volume"),
      JSON.stringify(quote.stats),
      url
    ],
  });

  return lastInsertRowId(result, "stock_history");
}

async function storePageDocument(
  db: Client,
  stockHistoryId: RowId,
  symbol: string,
  url: string,
  document: PageDocument
): Promise<bigint> {
  const result = await db.execute({
    sql: `
      INSERT INTO stock_documents (
        stock_history_id,
        captured_at,
        symbol,
        source_url,
        title,
        body_text,
        body_char_count,
        was_truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      stockHistoryId,
      new Date().toISOString(),
      symbol,
      url,
      document.title,
      document.bodyText,
      document.bodyCharCount,
      document.wasTruncated ? 1 : 0
    ],
  });

  return lastInsertRowId(result, "stock_documents");
}

async function storeCompletedAnalysis(
  db: Client,
  stockHistoryId: RowId,
  documentId: RowId,
  symbol: string,
  config: LlmConfig,
  promptText: string,
  inputText: string,
  result: LlmResult
): Promise<bigint> {
  const recommendation = extractRecommendation(result.analysisText);
  const insertResult = await db.execute({
    sql: `
      INSERT INTO stock_analyses (
        stock_history_id,
        document_id,
        created_at,
        symbol,
        provider,
        model,
        status,
        recommendation,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      stockHistoryId,
      documentId,
      new Date().toISOString(),
      symbol,
      config.provider,
      result.model,
      "completed",
      recommendation,
      promptPath,
      promptText,
      inputText.length,
      result.analysisText.length,
      result.analysisText,
      "",
      result.responseId,
      result.usageJson,
      result.rawResponseJson
    ],
  });

  return lastInsertRowId(insertResult, "stock_analyses");
}

async function storeFailedAnalysis(
  db: Client,
  stockHistoryId: RowId,
  documentId: RowId,
  symbol: string,
  config: LlmConfig,
  promptText: string,
  inputText: string,
  errorText: string
): Promise<bigint> {
  const result = await db.execute({
    sql: `
      INSERT INTO stock_analyses (
        stock_history_id,
        document_id,
        created_at,
        symbol,
        provider,
        model,
        status,
        recommendation,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      stockHistoryId,
      documentId,
      new Date().toISOString(),
      symbol,
      config.provider,
      config.model,
      "failed",
      "",
      promptPath,
      promptText,
      inputText.length,
      0,
      "",
      errorText,
      "",
      "{}",
      "{}"
    ],
  });

  return lastInsertRowId(result, "stock_analyses");
}

async function recentStockHistoryRows(
  db: Client,
  symbol: string
): Promise<HftHistoryRow[]> {
  const result = await db.execute({
    sql: `
      SELECT
        id,
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
        avg_volume_text
      FROM (
        SELECT *
        FROM stock_history
        WHERE UPPER(symbol) = UPPER(?)
        ORDER BY fetched_at DESC, id DESC
        LIMIT 60
      )
      ORDER BY fetched_at ASC, id ASC
    `,
    args: [symbol],
  });

  return result.rows as unknown as HftHistoryRow[];
}

async function storeCompletedHftAnalysis(
  db: Client,
  stockHistoryId: RowId,
  documentId: RowId,
  symbol: string,
  config: LlmConfig,
  promptText: string,
  inputText: string,
  historyRows: HftHistoryRow[],
  result: LlmResult,
  parsed: HftParsedResult
): Promise<bigint> {
  const insertResult = await db.execute({
    sql: `
      INSERT INTO stock_hft_analyses (
        stock_history_id,
        document_id,
        created_at,
        symbol,
        provider,
        model,
        status,
        decision,
        confidence,
        market_regime,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json,
        history_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      stockHistoryId,
      documentId,
      new Date().toISOString(),
      symbol,
      config.provider,
      result.model,
      "completed",
      parsed.decision,
      parsed.confidence,
      parsed.marketRegime,
      hftPromptPath,
      promptText,
      inputText.length,
      result.analysisText.length,
      result.analysisText,
      "",
      result.responseId,
      result.usageJson,
      result.rawResponseJson,
      JSON.stringify(historyRows)
    ],
  });

  return lastInsertRowId(insertResult, "stock_hft_analyses");
}

async function storeFailedHftAnalysis(
  db: Client,
  stockHistoryId: RowId,
  documentId: RowId,
  symbol: string,
  config: LlmConfig,
  promptText: string,
  inputText: string,
  historyRows: HftHistoryRow[],
  errorText: string,
  analysisText = ""
): Promise<bigint> {
  const result = await db.execute({
    sql: `
      INSERT INTO stock_hft_analyses (
        stock_history_id,
        document_id,
        created_at,
        symbol,
        provider,
        model,
        status,
        decision,
        confidence,
        market_regime,
        prompt_path,
        prompt_text,
        input_char_count,
        output_char_count,
        analysis_text,
        error_text,
        llm_response_id,
        usage_json,
        raw_response_json,
        history_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      stockHistoryId,
      documentId,
      new Date().toISOString(),
      symbol,
      config.provider,
      config.model,
      "failed",
      "",
      null,
      "",
      hftPromptPath,
      promptText,
      inputText.length,
      analysisText.length,
      analysisText,
      errorText,
      "",
      "{}",
      "{}",
      JSON.stringify(historyRows)
    ],
  });

  return lastInsertRowId(result, "stock_hft_analyses");
}

async function latestAnalysisRun(
  db: Client,
  symbol: string
): Promise<LatestAnalysisRun | null> {
  const result = await db.execute({
    sql: `
      SELECT created_at, status, provider, model
      FROM stock_analyses
      WHERE UPPER(symbol) = UPPER(?)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    args: [symbol],
  });

  return (result.rows[0] as unknown as LatestAnalysisRun | undefined) ?? null;
}

async function latestHftAnalysisRun(
  db: Client,
  symbol: string
): Promise<LatestAnalysisRun | null> {
  const result = await db.execute({
    sql: `
      SELECT created_at, status, provider, model
      FROM stock_hft_analyses
      WHERE UPPER(symbol) = UPPER(?)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    args: [symbol],
  });

  return (result.rows[0] as unknown as LatestAnalysisRun | undefined) ?? null;
}

async function acceptYahooConsent(page: Page): Promise<boolean> {
  const clicked = await page.evaluate((): boolean => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button, input[type="submit"]'
      )
    ).find((element) => {
      const text = (
        element instanceof HTMLInputElement
          ? element.value
          : element.textContent || ""
      ).trim();
      return /^(agree|accept|accept all|i agree)$/i.test(text);
    });

    if (!button) {
      return false;
    }

    button.click();
    return true;
  });

  if (clicked) {
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});
  }

  return clicked;
}

async function getPageDocument(
  page: Page,
  maxChars: number
): Promise<PageDocument> {
  return page.evaluate((limit): PageDocument => {
    const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
    const bodyText = clean(document.body?.innerText || "");

    return {
      title: clean(document.title || ""),
      bodyText: bodyText.slice(0, limit),
      bodyCharCount: bodyText.length,
      wasTruncated: bodyText.length > limit,
    };
  }, maxChars);
}

async function getQuote(page: Page): Promise<Quote> {
  await page.waitForFunction(
    () =>
      [
        '[data-testid="qsp-price"]',
        'fin-streamer[data-field="regularMarketPrice"]',
        '[data-field="regularMarketPrice"]',
      ].some((selector) => document.querySelector(selector)?.textContent?.trim()),
    { timeout: 45000 }
  );

  return page.evaluate((): Quote => {
    const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
    const text = (selector: string): string => {
      const element = document.querySelector(selector);
      return element ? clean(element.textContent || "") : "";
    };

    const statsByLabel: Record<string, string> = {};

    for (const row of document.querySelectorAll("li, table tr")) {
      const parts = Array.from(row.children)
        .map((child) => clean(child.textContent || ""))
        .filter(Boolean);

      if (parts.length >= 2) {
        const label = parts[0];
        const value = parts[1];

        if (label && value) {
          statsByLabel[label.toLowerCase()] = value;
        }
      }
    }

    const wantedStats = [
      "Previous Close",
      "Open",
      "Day's Range",
      "Market Cap",
      "Volume",
      "Avg. Volume",
    ] as const;

    const stats: QuoteStat[] = wantedStats.flatMap((label) => {
      const value = statsByLabel[label.toLowerCase()];
      return value ? [{ label, value }] : [];
    });

    return {
      name: text("h1"),
      price:
        text('[data-testid="qsp-price"]') ||
        text('fin-streamer[data-field="regularMarketPrice"]') ||
        text('[data-field="regularMarketPrice"]'),
      change:
        text('[data-testid="qsp-price-change"]') ||
        text('fin-streamer[data-field="regularMarketChange"]') ||
        text('[data-field="regularMarketChange"]'),
      changePercent:
        text('[data-testid="qsp-price-change-percent"]') ||
        text('fin-streamer[data-field="regularMarketChangePercent"]') ||
        text('[data-field="regularMarketChangePercent"]'),
      stats,
    };
  });
}

async function processSymbol(
  db: Client,
  page: Page,
  symbol: string,
  llmConfig: LlmConfig | null,
  documentMaxChars: number
): Promise<void> {
  const url = quoteUrl(symbol);

  const fetchStartTime = performance.now();
  log(`[${symbol}] Before fetch: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  log(`[${symbol}] After fetch: page loaded in ${elapsedSince(fetchStartTime)}`);

  const clickedConsent = await acceptYahooConsent(page);
  log(
    clickedConsent
      ? `[${symbol}] Accepted Yahoo consent prompt`
      : `[${symbol}] No Yahoo consent prompt found`
  );

  const quoteStartTime = performance.now();
  log(`[${symbol}] Waiting for quote data`);
  const quote = await getQuote(page);
  log(`[${symbol}] Quote data extracted in ${elapsedSince(quoteStartTime)}`);

  if (!quote.price) {
    throw new Error("Could not find the current price on Yahoo Finance.");
  }

  log(`[${symbol}] Storing quote history row`);
  const rowId = await storeQuoteHistory(db, symbol, url, quote);
  log(`[${symbol}] Stored quote history row id=${rowId.toString()}`);

  log(`[${symbol}] Capturing website body for analysis, maxChars=${documentMaxChars}`);
  const pageDocument = await getPageDocument(page, documentMaxChars);
  log(
    `[${symbol}] Captured website body chars=${pageDocument.bodyCharCount}, ` +
      `truncated=${pageDocument.wasTruncated}`
  );

  log(`[${symbol}] Storing website document row`);
  const documentId = await storePageDocument(db, rowId, symbol, url, pageDocument);
  log(`[${symbol}] Stored website document row id=${documentId.toString()}`);

  if (llmConfig) {
    const latestAnalysis = await latestAnalysisRun(db, symbol);
    const latestAnalysisTime = latestAnalysis
      ? Date.parse(latestAnalysis.created_at)
      : 0;
    const latestAnalysisAgeMs = Date.now() - latestAnalysisTime;

    if (
      latestAnalysis &&
      Number.isFinite(latestAnalysisTime) &&
      latestAnalysisAgeMs <= llmAnalysisCooldownMs
    ) {
      log(
        `[${symbol}] Skipping LLM analysis: latest analysis ran ${formatDuration(
          Math.max(latestAnalysisAgeMs, 0)
        )} ago at ${latestAnalysis.created_at} ` +
          `(status=${latestAnalysis.status}, provider=${latestAnalysis.provider}, ` +
          `model=${latestAnalysis.model}); cooldown=${formatDuration(
            llmAnalysisCooldownMs
          )}.`
      );
    } else {
      const promptText = readAnalysisPrompt();
      const analysisInput = buildAnalysisPrompt(promptText, pageDocument.bodyText);

      log(`[${symbol}] Running ${promptPath} with ${llmConfig.provider}/${llmConfig.model}`);
      const llmStartTime = performance.now();

      try {
        const analysis = await runLlmAnalysis(llmConfig, analysisInput);
        log(`[${symbol}] LLM analysis completed in ${elapsedSince(llmStartTime)}`);

        const analysisId = await storeCompletedAnalysis(
          db,
          rowId,
          documentId,
          symbol,
          llmConfig,
          promptText,
          analysisInput,
          analysis
        );
        const recommendation =
          extractRecommendation(analysis.analysisText) || "unknown";
        log(
          `[${symbol}] Stored completed LLM analysis row id=${analysisId.toString()}, ` +
            `recommendation=${recommendation}`
        );
      } catch (error: unknown) {
        const errorText = error instanceof Error ? error.message : String(error);
        log(`[${symbol}] LLM analysis failed: ${errorText}`);

        const analysisId = await storeFailedAnalysis(
          db,
          rowId,
          documentId,
          symbol,
          llmConfig,
          promptText,
          analysisInput,
          errorText
        );
        log(`[${symbol}] Stored failed LLM analysis row id=${analysisId.toString()}`);
      }
    }

    const latestHftAnalysis = await latestHftAnalysisRun(db, symbol);
    const latestHftAnalysisTime = latestHftAnalysis
      ? Date.parse(latestHftAnalysis.created_at)
      : 0;
    const latestHftAnalysisAgeMs = Date.now() - latestHftAnalysisTime;

    if (
      latestHftAnalysis &&
      Number.isFinite(latestHftAnalysisTime) &&
      latestHftAnalysisAgeMs <= hftAnalysisCooldownMs
    ) {
      log(
        `[${symbol}] Skipping HFT analysis: latest HFT run was ${formatDuration(
          Math.max(latestHftAnalysisAgeMs, 0)
        )} ago at ${latestHftAnalysis.created_at} ` +
          `(status=${latestHftAnalysis.status}, provider=${latestHftAnalysis.provider}, ` +
          `model=${latestHftAnalysis.model}); cooldown=${formatDuration(
            hftAnalysisCooldownMs
          )}.`
      );
    } else {
      const hftPromptText = readHftPrompt();
      const hftHistoryRows = await recentStockHistoryRows(db, symbol);
      const hftInput = buildHftPrompt(
        hftPromptText,
        symbol,
        pageDocument,
        hftHistoryRows
      );

      log(
        `[${symbol}] Running ${hftPromptPath} with ${llmConfig.provider}/${llmConfig.model}; ` +
          `historyRows=${hftHistoryRows.length}`
      );
      const hftStartTime = performance.now();
      let hftResult: LlmResult | null = null;

      try {
        hftResult = await runLlmAnalysis(llmConfig, hftInput);
        const parsed = parseHftResult(hftResult.analysisText);
        log(`[${symbol}] HFT analysis completed in ${elapsedSince(hftStartTime)}`);

        const hftAnalysisId = await storeCompletedHftAnalysis(
          db,
          rowId,
          documentId,
          symbol,
          llmConfig,
          hftPromptText,
          hftInput,
          hftHistoryRows,
          hftResult,
          parsed
        );
        log(
          `[${symbol}] Stored completed HFT analysis row id=${hftAnalysisId.toString()}, ` +
            `decision=${parsed.decision || "unknown"}, ` +
            `confidence=${parsed.confidence ?? "unknown"}, ` +
            `regime=${parsed.marketRegime || "unknown"}`
        );
      } catch (error: unknown) {
        const errorText = error instanceof Error ? error.message : String(error);
        log(`[${symbol}] HFT analysis failed: ${errorText}`);

        const hftAnalysisId = await storeFailedHftAnalysis(
          db,
          rowId,
          documentId,
          symbol,
          llmConfig,
          hftPromptText,
          hftInput,
          hftHistoryRows,
          errorText,
          hftResult?.analysisText ?? ""
        );
        log(`[${symbol}] Stored failed HFT analysis row id=${hftAnalysisId.toString()}`);
      }
    }
  }

  const change = [quote.change, quote.changePercent].filter(Boolean).join(" ");
  const statText = quote.stats
    .slice(0, 4)
    .map((stat) => `${stat.label}: ${stat.value}`)
    .join(" | ");
  const message = [change && `Change: ${change}`, statText]
    .filter(Boolean)
    .join(" | ");
  const title = `${symbol} ${quote.price}`;
  const subtitle = quote.name || "Yahoo Finance";

  log(`[${symbol}] Quote result: ${title} - ${message}`);
  log(`[${symbol}] Sending top-right macOS banner notification`);
  await showNotification(title, subtitle, message || "Quote loaded.")
    .then(() => {
      log(`[${symbol}] Top-right macOS banner notification command completed`);
    })
    .catch((error: unknown) => {
      const notificationError =
        error instanceof Error ? error.message : String(error);
      log(
        `[${symbol}] Top-right macOS banner notification command failed: ` +
          notificationError
      );
    });
}

async function main(): Promise<void> {
  const startTime = performance.now();
  let browser: Browser | undefined;
  let db: Client | undefined;

  log("Start");

  try {
    const symbols = parseSymbolsEnv();
    const llmConfig = getLlmConfig();
    const documentMaxChars = parsePositiveIntegerEnv("LLM_DOCUMENT_MAX_CHARS", 50000);

    log(`Loaded SYMBOLS=${symbols.join(",")}`);
    log(
      llmConfig
        ? `LLM enabled: provider=${llmConfig.provider}, model=${llmConfig.model}`
        : "OPENROUTER_API_KEY and OPENROUTER_MODEL are not set; LLM analysis will be skipped"
    );
    log("Connecting to Turso database");
    db = await connectDatabase();
    log("Turso database ready");

    log("Launching browser");
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: await puppeteer.executablePath({ headless: "shell" }),
      headless: "shell",
    });
    log("Browser launched");

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    const failures: string[] = [];

    for (const [index, symbol] of symbols.entries()) {
      const symbolStartTime = performance.now();
      log(`[${symbol}] Start (${index + 1}/${symbols.length})`);

      try {
        await processSymbol(db, page, symbol, llmConfig, documentMaxChars);
        log(`[${symbol}] End. Total time: ${elapsedSince(symbolStartTime)}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${symbol}: ${message}`);
        log(`[${symbol}] Failed: ${message}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Failed symbols: ${failures.join("; ")}`);
    }
  } finally {
    if (db) {
      log("Closing Turso database");
      db.close();
      log("Turso database closed");
    }

    if (browser) {
      log("Closing browser");
      await browser.close();
      log("Browser closed");
    }

    log(`End. Total time: ${elapsedSince(startTime)}`);
  }
}

main().catch(async (error: unknown): Promise<void> => {
  const symbols = process.env.SYMBOLS?.trim() || "SYMBOLS";
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  await showNotification("Stock check failed", symbols, message).catch(() => {});
  process.exitCode = 1;
});
