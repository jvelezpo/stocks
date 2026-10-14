import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_OPENCODE_MODEL = "muse-spark-1.3-contributor-free";
export const DEFAULT_OPENCODE_CLI = "opencode";
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 600;
const OPENCODE_VARIANT = "minimal";

export type OpencodeCliOptions = {
  model: string;
  timeoutMs: number;
  cliPath?: string;
  maxOutputTokens?: number;
};

export type OpencodeCliResult = {
  text: string;
  sessionId: string;
  usageJson: string;
  rawResponseJson: string;
};

type OpencodeCliMock = (
  prompt: string,
  options: OpencodeCliOptions
) => Promise<OpencodeCliResult>;

function getTestMock(): OpencodeCliMock | null {
  const mock = (globalThis as Record<string, unknown>).__opencodeCliMock;
  return typeof mock === "function" ? (mock as OpencodeCliMock) : null;
}

export function normalizeOpencodeModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return `opencode/${DEFAULT_OPENCODE_MODEL}`;
  }
  return trimmed.includes("/") ? trimmed : `opencode/${trimmed}`;
}

export function resolveOpencodeCliPath(): string {
  return process.env.OPENCODE_CLI_PATH?.trim() || DEFAULT_OPENCODE_CLI;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractCliErrorMessage(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  const error = value.error;
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    const data = isRecord(error.data) ? error.data : null;
    const message =
      (typeof error.message === "string" && error.message) ||
      (data && typeof data.message === "string" ? data.message : "") ||
      "";
    // Unwrap the common Zen wrapper: "Error from provider (Console): <detail>".
    const detail = isRecord(data?.responseBody)
      ? ""
      : typeof data?.responseBody === "string"
        ? extractNestedErrorMessage(data.responseBody)
        : "";
    return [message, detail].filter(Boolean).join(" ").trim();
  }
  return typeof value.message === "string" ? value.message : "";
}

function extractNestedErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the raw message.
  }
  return "";
}

function extractTextPart(event: unknown): string {
  if (!isRecord(event) || event.type !== "text") {
    return "";
  }
  const part = event.part;
  if (!isRecord(part)) {
    return "";
  }
  // Observed shape: { type: "text", part: { type: "text", text: "..." } }
  if (typeof part.text === "string" && part.text.trim()) {
    return part.text;
  }
  return "";
}

/**
 * Run a single non-interactive prompt through the OpenCode CLI.
 *
 * Uses `opencode run --format json` with the prompt as its required positional
 * argument and runs in a fresh empty temp dir so any file-tool calls the model
 * attempts cannot see the project checkout.
 *
 * NOTE: custom permission overrides (OPENCODE_PERMISSION /
 * OPENCODE_CONFIG_CONTENT / custom agents with deny rules) break the Zen
 * free tier with "can only be used from within OpenCode", so this runner
 * intentionally uses the default agent/permissions and does not set them.
 */
export async function runOpencodePrompt(
  prompt: string,
  options: OpencodeCliOptions
): Promise<OpencodeCliResult> {
  const mock = getTestMock();
  if (mock) {
    return mock(prompt, options);
  }

  const model = normalizeOpencodeModel(options.model);
  const cliPath = options.cliPath?.trim() || resolveOpencodeCliPath();
  const timeoutMs = options.timeoutMs;

  if (!prompt.trim()) {
    throw new Error("Opencode CLI prompt was empty.");
  }

  const serverUrl = process.env.OPENCODE_SERVER_URL?.trim();
  if (serverUrl) {
    return runPromptOnServer(prompt, {
      model,
      serverUrl,
      timeoutMs,
    });
  }

  const workDir = await mkdtemp(join(tmpdir(), "opencode-llm-"));
  try {
    return await runCliInDir(prompt, { model, timeoutMs, cliPath, workDir, maxOutputTokens: options.maxOutputTokens });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPromptOnServer(
  prompt: string,
  args: { model: string; serverUrl: string; timeoutMs: number }
): Promise<OpencodeCliResult> {
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  if (!password) {
    throw new Error("OPENCODE_SERVER_PASSWORD is required when OPENCODE_SERVER_URL is set.");
  }

  const username = process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode";
  const baseUrl = args.serverUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
    "x-opencode-directory": "/tmp",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  timer.unref?.();

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenCode server returned ${response.status}: ${body.slice(0, 500) || response.statusText}`
      );
    }
    if (!body) return null;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("OpenCode server returned invalid JSON.");
    }
  }

  let sessionId = "";
  try {
    const session = await request("/session", {
      method: "POST",
      body: JSON.stringify({ title: "Signal Desk analysis" }),
    });
    if (!isRecord(session) || typeof session.id !== "string" || !session.id) {
      throw new Error("OpenCode server did not return a session id.");
    }
    sessionId = session.id;

    const separator = args.model.indexOf("/");
    const response = await request(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify({
        model: {
          providerID: args.model.slice(0, separator),
          modelID: args.model.slice(separator + 1),
        },
        variant: OPENCODE_VARIANT,
        parts: [{ type: "text", text: prompt }],
      }),
    });

    if (!isRecord(response) || !Array.isArray(response.parts)) {
      throw new Error("OpenCode server returned an invalid message response.");
    }
    const text = response.parts
      .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) {
      throw new Error("OpenCode server did not return text output.");
    }

    const info = isRecord(response.info) ? response.info : {};
    const usage = info.tokens ?? {};
    return {
      text,
      sessionId,
      usageJson: JSON.stringify(usage),
      rawResponseJson: JSON.stringify({
        server: baseUrl,
        model: args.model,
        variant: OPENCODE_VARIANT,
        response,
      }),
    };
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`OpenCode server timed out after ${args.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (sessionId) {
      await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  }
}

async function runCliInDir(
  prompt: string,
  args: { model: string; timeoutMs: number; cliPath: string; workDir: string; maxOutputTokens?: number }
): Promise<OpencodeCliResult> {
  const cliArgs = [
    "run",
    "--format",
    "json",
    "-m",
    args.model,
    "--variant",
    OPENCODE_VARIANT,
    "--dir",
    args.workDir,
    "--",
    prompt,
  ];
  const childEnv = { ...process.env };
  delete childEnv.OPENCODE_SERVER_PASSWORD;
  delete childEnv.OPENCODE_SERVER_USERNAME;

  return new Promise<OpencodeCliResult>((resolve, reject) => {
    const child = spawn(args.cliPath, cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...childEnv,
        ...(args.maxOutputTokens && args.maxOutputTokens > 0
          ? { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(args.maxOutputTokens) }
          : {}),
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore kill failures; the process already exited or never started.
      }
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Opencode CLI timed out after ${args.timeoutMs}ms.`));
    }, args.timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      // Guard against runaway output (JSONL events + tool output).
      if (stdout.length > 10 * 1024 * 1024) {
        fail(new Error("Opencode CLI output exceeded 10MB."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      const hint =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? ` Is the OpenCode CLI installed (expected at "${args.cliPath}")? Override with OPENCODE_CLI_PATH.`
          : "";
      fail(new Error(`Opencode CLI failed to start: ${error.message}.${hint}`));
    });
    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;

      try {
        const result = parseCliOutput(stdout, args.model);
        if (code !== 0 && !result.text) {
          const detail = stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500);
          reject(
            new Error(
              `Opencode CLI exited with code ${code ?? signal ?? "unknown"}${detail ? `: ${detail}` : "."}`
            )
          );
          return;
        }
        resolve(result);
      } catch (error: unknown) {
        const detail = stderr.trim().slice(0, 500);
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(detail ? `${message} (stderr: ${detail})` : message));
      }
    });
  });
}

function parseCliOutput(stdout: string, model: string): OpencodeCliResult {
  const texts: string[] = [];
  let sessionId = "";
  let usage: unknown = null;
  const cliErrors: string[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(event)) {
      continue;
    }
    if (typeof event.sessionID === "string" && event.sessionID && !sessionId) {
      sessionId = event.sessionID;
    }
    if (event.type === "error") {
      const message = extractCliErrorMessage(event);
      if (message) {
        cliErrors.push(message);
      }
      continue;
    }
    const text = extractTextPart(event);
    if (text) {
      texts.push(text);
      continue;
    }
    if (event.type === "step_finish" && isRecord(event.part)) {
      const tokens = (event.part as Record<string, unknown>).tokens;
      if (tokens !== undefined) {
        usage = tokens;
      }
    }
  }

  if (cliErrors.length > 0) {
    throw new Error(`Opencode CLI request failed: ${cliErrors.join(" ")}`.slice(0, 1000));
  }

  const text = texts.join("\n").trim();
  if (!text) {
    throw new Error("Opencode CLI did not return text output.");
  }

  const usageJson = usage !== null ? JSON.stringify(usage) : "{}";
  return {
    text,
    sessionId,
    usageJson,
    rawResponseJson: JSON.stringify({
      cli: "opencode run --format json",
      model,
      variant: OPENCODE_VARIANT,
      sessionId,
      usage: usage ?? {},
    }),
  };
}
