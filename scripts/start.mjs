import { spawn } from "node:child_process";

const processes = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "5000"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--env-file=.env", "workers.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }),
];

let shuttingDown = false;
let exitCode = 0;
let forceExitTimer;

function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;

  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }

  forceExitTimer = setTimeout(() => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 5_000);
}

for (const child of processes) {
  child.once("error", (error) => {
    console.error(`[start] ${error.message}`);
    shutdown("SIGTERM", 1);
  });
  child.once("close", (code) => {
    if (!shuttingDown) {
      shutdown("SIGTERM", code ?? 1);
    }

    if (processes.every((process) => process.exitCode !== null || process.signalCode !== null)) {
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(exitCode);
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT", 130));
process.once("SIGTERM", () => shutdown("SIGTERM", 143));
