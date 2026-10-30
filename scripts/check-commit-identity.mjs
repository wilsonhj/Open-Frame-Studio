#!/usr/bin/env node
/**
 * Fails when a commit in a range uses an email other than a GitHub noreply
 * address (CLAUDE.md, "Commit identity"). Checks author and committer.
 *
 *   node scripts/check-commit-identity.mjs <base>..<head>
 *   node scripts/check-commit-identity.mjs              # CI: range from the GitHub event
 *
 * With no range and no usable event (a new branch, a first push), it checks
 * nothing and says so: old history is not re-judged.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** GitHub's per-user noreply addresses and GitHub's own web-flow committer. */
export function isAllowedEmail(email) {
  const e = String(email).trim().toLowerCase();
  return /^(\d+\+)?[a-z0-9-]+(\[bot\])?@users\.noreply\.github\.com$/.test(e) || e === "noreply@github.com";
}

/** One line per offending commit, or [] when the range is clean. */
export function findViolations(log) {
  const out = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, author, committer, subject] = line.split("\x1f");
    const bad = [author, committer].filter((e) => !isAllowedEmail(e));
    if (bad.length) out.push(`${sha.slice(0, 12)} ${subject} (uses ${[...new Set(bad)].join(", ")})`);
  }
  return out;
}

function hasCommit(sha) {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
}

/** The range a GitHub event adds, or null when there is nothing to judge. */
export function rangeFromEvent(event, commitExists = hasCommit) {
  if (event.pull_request) return `${event.pull_request.base.sha}..${event.pull_request.head.sha}`;
  if (event.before && event.after && !/^0+$/.test(event.before)) {
    // A force-push drops `before` from the clone: check the pushed tip (and a merge's side branch) instead.
    return commitExists(event.before) ? `${event.before}..${event.after}` : `${event.after}^!`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const range = process.argv[2] ?? (eventPath ? rangeFromEvent(JSON.parse(readFileSync(eventPath, "utf8"))) : null);
  if (!range) {
    console.log("check-commit-identity: no range to check (skipped)");
    process.exit(0);
  }
  const log = execFileSync("git", ["log", "--format=%H%x1f%ae%x1f%ce%x1f%s", range], { encoding: "utf8" });
  const violations = findViolations(log);
  if (violations.length) {
    console.error(`check-commit-identity: ${violations.length} commit(s) use an email other than a GitHub noreply address:`);
    for (const v of violations) console.error(`  ${v}`);
    console.error("Set: git config user.email 39320700+wilsonhj@users.noreply.github.com (see CLAUDE.md), then re-author these commits.");
    process.exit(1);
  }
  console.log(`check-commit-identity ok: ${range}`);
}
