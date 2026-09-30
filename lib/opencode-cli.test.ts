import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runOpencodePrompt } from "./opencode-cli.ts";

test("passes the prompt and fastest model variant to OpenCode", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "opencode-cli-test-"));
  const cliPath = join(fixtureDir, "fake-opencode");
  const argsPath = join(fixtureDir, "args.json");
  const previousArgsPath = process.env.OPENCODE_TEST_ARGS_PATH;

  await writeFile(
    cliPath,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.OPENCODE_TEST_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "text", sessionID: "session-1", part: { type: "text", text: "Fixture reply" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_finish", part: { tokens: { input: 10, output: 2 } } }) + "\\n");
`
  );
  await chmod(cliPath, 0o755);
  process.env.OPENCODE_TEST_ARGS_PATH = argsPath;

  try {
    const prompt = "Explain the latest stock capture.";
    const result = await runOpencodePrompt(prompt, {
      model: "muse-spark-1.3-contributor-free",
      timeoutMs: 5_000,
      cliPath,
    });
    const cliArgs = JSON.parse(await readFile(argsPath, "utf8")) as string[];

    assert.deepEqual(cliArgs.slice(0, 7), [
      "run",
      "--format",
      "json",
      "-m",
      "opencode/muse-spark-1.3-contributor-free",
      "--variant",
      "minimal",
    ]);
    assert.equal(cliArgs.at(-2), "--");
    assert.equal(cliArgs.at(-1), prompt);
    assert.equal(result.text, "Fixture reply");
    assert.equal(result.sessionId, "session-1");
    assert.deepEqual(JSON.parse(result.usageJson), { input: 10, output: 2 });
    assert.equal(JSON.parse(result.rawResponseJson).variant, "minimal");
  } finally {
    if (previousArgsPath === undefined) {
      delete process.env.OPENCODE_TEST_ARGS_PATH;
    } else {
      process.env.OPENCODE_TEST_ARGS_PATH = previousArgsPath;
    }
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
