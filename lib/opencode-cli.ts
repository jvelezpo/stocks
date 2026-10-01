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

  const workDir = await mkdtemp(join(tmpdir(), "opencode-llm-"));
  try {
    return await runCliInDir(prompt, { model, timeoutMs, cliPath, workDir, maxOutputTokens: options.maxOutputTokens });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
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

  return new Promise<OpencodeCliResult>((resolve, reject) => {
    const child = spawn(args.cliPath, cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
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
