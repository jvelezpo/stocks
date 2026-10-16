import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { incrementVersion, semanticBumpForMessage } from "./semantic-version.mjs";

const messageFile = process.argv[2];

if (!messageFile) {
  console.error("Missing commit message file.");
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

const unstagedChanges = run("git", [
  "diff",
  "--quiet",
  "--",
  "package.json",
  "package-lock.json",
]);

if (unstagedChanges.status !== 0) {
  console.error(
    "Commit aborted: stage or discard package.json and package-lock.json changes before committing.",
  );
  process.exit(1);
}

let bump;

try {
  bump = semanticBumpForMessage(readFileSync(messageFile, "utf8"));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const packageInfo = JSON.parse(readFileSync("package.json", "utf8"));
const committedPackage = run("git", ["show", "HEAD:package.json"]);
const baseVersion =
  committedPackage.status === 0 ? JSON.parse(committedPackage.stdout).version : packageInfo.version;
const nextVersion = incrementVersion(baseVersion, bump);

if (packageInfo.version !== baseVersion && packageInfo.version !== nextVersion) {
  console.error(
    `Commit aborted: package.json version ${packageInfo.version} conflicts with expected ${nextVersion}.`,
  );
  process.exit(1);
}

const npmVersion = run(
  "npm",
  [
    "version",
    nextVersion,
    "--no-git-tag-version",
    "--allow-same-version",
    "--ignore-scripts",
  ],
  { stdio: "inherit" },
);

if (npmVersion.status !== 0) {
  process.exit(npmVersion.status ?? 1);
}

const stageVersion = run("git", ["add", "--", "package.json", "package-lock.json"], {
  stdio: "inherit",
});

if (stageVersion.status !== 0) {
  process.exit(stageVersion.status ?? 1);
}

console.log(`Version bumped (${bump}): v${nextVersion}`);
