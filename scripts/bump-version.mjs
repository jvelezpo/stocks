import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { incrementVersion, semanticBumpForMessage } from "./semantic-version.mjs";

const versionPaths = ["package.json", "package-lock.json"];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(value, description) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`Commit aborted: ${description} is not valid JSON.`);
  }
}

function validateCommit(messageFile) {
  if (!messageFile) {
    fail("Missing commit message file.");
  }

  let bump;

  try {
    bump = semanticBumpForMessage(readFileSync(messageFile, "utf8"));
  } catch (error) {
    fail(error instanceof Error ? error.message : error);
  }

  const unstagedChanges = run("git", ["diff", "--quiet", "--", ...versionPaths]);

  if (unstagedChanges.status !== 0) {
    fail(
      "Commit aborted: stage or discard package.json and package-lock.json changes before committing.",
    );
  }

  const packageInfo = readJson(readFileSync("package.json", "utf8"), "package.json");
  const lockInfo = readJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
  const versions = [packageInfo.version, lockInfo.version, lockInfo.packages?.[""]?.version];

  if (versions.some((version) => version !== packageInfo.version)) {
    fail("Commit aborted: package.json and package-lock.json versions must match.");
  }

  const committedPackage = run("git", ["show", "HEAD:package.json"]);

  if (committedPackage.status !== 0) {
    return;
  }

  const baseVersion = readJson(committedPackage.stdout, "HEAD package.json").version;
  const nextVersion = incrementVersion(baseVersion, bump);

  if (packageInfo.version !== baseVersion && packageInfo.version !== nextVersion) {
    fail(
      `Commit aborted: package version ${packageInfo.version} conflicts with expected ${nextVersion}.`,
    );
  }
}

function amendHeadWithVersion() {
  const headMessage = run("git", ["log", "-1", "--format=%B"]);

  if (headMessage.status !== 0) {
    fail("Version bump failed: could not read the new commit message.");
  }

  let bump;

  try {
    bump = semanticBumpForMessage(headMessage.stdout);
  } catch (error) {
    fail(error instanceof Error ? error.message : error);
  }

  const packageInfo = readJson(readFileSync("package.json", "utf8"), "package.json");
  const parentPackage = run("git", ["show", "HEAD^:package.json"]);
  const baseVersion =
    parentPackage.status === 0
      ? readJson(parentPackage.stdout, "parent package.json").version
      : packageInfo.version;
  const nextVersion = incrementVersion(baseVersion, bump);

  if (packageInfo.version === nextVersion) {
    console.log(`Version already included (${bump}): v${nextVersion}`);
    return;
  }

  if (packageInfo.version !== baseVersion) {
    fail(
      `Version bump failed: package.json version ${packageInfo.version} conflicts with expected ${nextVersion}.`,
    );
  }

  const packageChangesAfterCommit = run("git", ["diff", "--quiet", "HEAD", "--", ...versionPaths]);

  if (packageChangesAfterCommit.status !== 0) {
    fail(
      "Version bump failed: package files changed outside the new commit; amend them explicitly before continuing.",
    );
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

  const amend = run(
    "git",
    [
      "commit",
      "--amend",
      "--no-edit",
      "--no-verify",
      "--only",
      "--",
      ...versionPaths,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, STOCKS_VERSION_AMEND: "1" },
    },
  );

  if (amend.status !== 0) {
    process.exit(amend.status ?? 1);
  }

  console.log(`Version bumped in commit (${bump}): v${nextVersion}`);
}

const [mode, value] = process.argv.slice(2);

if (mode === "validate-message") {
  validateCommit(value);
} else if (mode === "amend-head") {
  amendHeadWithVersion();
} else {
  fail("Unknown version hook mode.");
}
