import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { incrementVersion, semanticBumpForMessage } from "./semantic-version.mjs";

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, STOCKS_VERSION_AMEND: "" },
  });

  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
  );

  return result.stdout.trim();
}

test("maps Conventional Commit messages to version bumps", () => {
  assert.equal(semanticBumpForMessage("fix: handle empty results"), "patch");
  assert.equal(semanticBumpForMessage("docs(readme): explain setup"), "patch");
  assert.equal(semanticBumpForMessage("feat: add watchlist"), "minor");
  assert.equal(semanticBumpForMessage("feat(api)!: change response shape"), "major");
  assert.equal(
    semanticBumpForMessage("fix: accept new symbol\n\nBREAKING CHANGE: symbols are now case-sensitive"),
    "major",
  );
});

test("rejects non-conventional commit messages", () => {
  assert.throws(
    () => semanticBumpForMessage("update footer"),
    /must follow Conventional Commits/,
  );
});

test("increments semantic versions", () => {
  assert.equal(incrementVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(incrementVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(incrementVersion("1.2.3", "major"), "2.0.0");
});

test("includes the version bump in the commit that triggered it", () => {
  const repository = mkdtempSync(join(tmpdir(), "stocks-version-hook-"));

  try {
    mkdirSync(join(repository, ".githooks"));
    mkdirSync(join(repository, "scripts"));

    for (const hook of ["commit-msg", "post-commit"]) {
      const destination = join(repository, ".githooks", hook);
      copyFileSync(join(process.cwd(), ".githooks", hook), destination);
      chmodSync(destination, 0o755);
    }

    for (const script of ["bump-version.mjs", "semantic-version.mjs"]) {
      copyFileSync(join(process.cwd(), "scripts", script), join(repository, "scripts", script));
    }

    const packageInfo = {
      name: "version-hook-fixture",
      version: "1.2.3",
      private: true,
    };
    const packageLock = {
      name: packageInfo.name,
      version: packageInfo.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": packageInfo,
      },
    };

    writeFileSync(join(repository, "package.json"), `${JSON.stringify(packageInfo, null, 2)}\n`);
    writeFileSync(
      join(repository, "package-lock.json"),
      `${JSON.stringify(packageLock, null, 2)}\n`,
    );
    writeFileSync(join(repository, "initial.txt"), "initial\n");

    runGit(repository, ["init", "--quiet"]);
    runGit(repository, ["config", "user.name", "Version Hook Test"]);
    runGit(repository, ["config", "user.email", "version-hook@example.com"]);
    runGit(repository, ["config", "commit.gpgsign", "false"]);
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "--quiet", "-m", "chore: initialize fixture"]);
    runGit(repository, ["config", "core.hooksPath", ".githooks"]);

    writeFileSync(join(repository, "feature.txt"), "watchlist\n");
    runGit(repository, ["add", "feature.txt"]);
    runGit(repository, ["commit", "--quiet", "-m", "feat: add watchlist"]);

    assert.equal(runGit(repository, ["rev-list", "--count", "HEAD"]), "2");
    assert.equal(
      JSON.parse(runGit(repository, ["show", "HEAD:package.json"])).version,
      "1.3.0",
    );
    assert.equal(
      JSON.parse(runGit(repository, ["show", "HEAD:package-lock.json"])).version,
      "1.3.0",
    );
    assert.equal(runGit(repository, ["show", "HEAD:feature.txt"]), "watchlist");
    assert.equal(runGit(repository, ["status", "--short"]), "");
    assert.equal(
      JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).version,
      "1.3.0",
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
