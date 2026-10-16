import assert from "node:assert/strict";
import test from "node:test";
import { incrementVersion, semanticBumpForMessage } from "./semantic-version.mjs";

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
