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
import { execFileSync } from "node:child_process";
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

function rangeFromEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  const event = JSON.parse(readFileSync(path, "utf8"));
  if (event.pull_request) return `${event.pull_request.base.sha}..${event.pull_request.head.sha}`;
  if (event.before && event.after && !/^0+$/.test(event.before)) return `${event.before}..${event.after}`;
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const range = process.argv[2] ?? rangeFromEvent();
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
