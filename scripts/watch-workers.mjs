import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const libDirectory = resolve(projectRoot, "lib");
let worker = null;
let forceExitTimer = null;
let restarting = false;
let shuttingDown = false;
let exitCode = 0;
let checkingFiles = false;

function startWorker() {
  worker = spawn(process.execPath, ["--env-file=.env", "workers.ts"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  worker.once("error", (error) => {
    console.error(`[workers:dev] ${error.message}`);
    shutdown("SIGTERM", 1);
  });
  worker.once("close", (code) => {
    worker = null;
    if (restarting && !shuttingDown) {
      restarting = false;
      console.log("[workers:dev] Restarting workers...");
      startWorker();
      return;
    }

    if (!shuttingDown) {
      shutdown("SIGTERM", code ?? 1);
    }
    finishIfStopped();
  });
}

function restartWorker() {
  if (shuttingDown) return;
  restarting = true;
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill("SIGTERM");
  } else {
    restarting = false;
    startWorker();
  }
}

async function sourceSignature() {
  const entries = await readdir(libDirectory, { withFileTypes: true });
  const paths = [
    resolve(projectRoot, "workers.ts"),
    resolve(projectRoot, "stock-info.ts"),
    resolve(projectRoot, "reddit-sentiment.ts"),
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => resolve(libDirectory, entry.name)),
  ].sort();
  const details = await Promise.all(
    paths.map(async (path) => {
      const file = await stat(path);
      return `${path}:${file.mtimeMs}:${file.size}`;
    })
  );
  return details.join("|");
}

let previousSignature = await sourceSignature();
const watchInterval = setInterval(async () => {
  if (checkingFiles || shuttingDown) return;
  checkingFiles = true;
  try {
    const nextSignature = await sourceSignature();
    if (nextSignature !== previousSignature) {
      previousSignature = nextSignature;
      restartWorker();
    }
  } catch (error) {
    console.error(`[workers:dev] Could not check source files: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    checkingFiles = false;
  }
}, 500);

function finishIfStopped() {
  if (!shuttingDown || worker) return;
  if (forceExitTimer) clearTimeout(forceExitTimer);
  process.exit(exitCode);
}

function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  clearInterval(watchInterval);

  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill(signal);
    forceExitTimer = setTimeout(() => worker?.kill("SIGKILL"), 3_000);
  } else {
    worker = null;
  }
  finishIfStopped();
}

process.once("SIGINT", () => shutdown("SIGINT", 130));
process.once("SIGTERM", () => shutdown("SIGTERM", 143));

startWorker();
