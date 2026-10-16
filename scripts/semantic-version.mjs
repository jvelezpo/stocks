const conventionalHeader = /^([a-z][a-z0-9-]*)(?:\([^()\r\n]+\))?(!)?: \S.*$/;
const breakingFooter = /^BREAKING(?: CHANGE|-CHANGE): \S.*$/m;
const semanticVersion = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function semanticBumpForMessage(message) {
  const header = message.split(/\r?\n/, 1)[0];
  const match = conventionalHeader.exec(header);

  if (!match) {
    throw new Error(
      "Commit message must follow Conventional Commits (for example, fix: handle empty results).",
    );
  }

  if (match[2] || breakingFooter.test(message)) {
    return "major";
  }

  return match[1] === "feat" ? "minor" : "patch";
}

export function incrementVersion(version, bump) {
  const match = semanticVersion.exec(version);

  if (!match) {
    throw new Error(`Package version must be semantic (received ${version}).`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (bump === "major") {
    return `${major + 1}.0.0`;
  }

  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}
