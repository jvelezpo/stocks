import { spawnSync } from "node:child_process";

const repository = spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });

if (repository.status !== 0) {
  console.log("Skipping Git hook setup outside a Git checkout.");
  process.exit(0);
}

const configured = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

if (configured.status !== 0) {
  process.exit(configured.status ?? 1);
}

console.log("Configured Conventional Commit validation and in-commit version bump hooks.");
