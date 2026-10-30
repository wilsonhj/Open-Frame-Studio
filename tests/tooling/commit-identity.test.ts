/** Commit identity rule (CLAUDE.md): only GitHub noreply addresses. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// @ts-expect-error -- plain ESM script without type declarations
import { findViolations, isAllowedEmail, rangeFromEvent } from "../../scripts/check-commit-identity.mjs";

const HOOK = join(import.meta.dirname, "../../scripts/hooks/pre-commit");
const NOREPLY = "39320700+wilsonhj@users.noreply.github.com";

describe("commit identity", () => {
  it("allows GitHub noreply addresses, bots and the web-flow committer", () => {
    for (const ok of ["39320700+wilsonhj@users.noreply.github.com", "wilsonhj@users.noreply.github.com", "206951365+cursor[bot]@users.noreply.github.com", "noreply@github.com"]) {
      assert.ok(isAllowedEmail(ok), ok);
    }
  });

  it("rejects personal and other addresses", () => {
    for (const bad of ["someone@example.com", "noreply@anthropic.com", "cursoragent@cursor.com", "x@users.noreply.github.com.evil.com", ""]) {
      assert.equal(isAllowedEmail(bad), false, bad);
    }
  });

  it("reports each offending commit with the email it used", () => {
    const log = [
      ["aaaaaaaaaaaaaaaa", "39320700+wilsonhj@users.noreply.github.com", "noreply@github.com", "fine"].join("\x1f"),
      ["bbbbbbbbbbbbbbbb", "someone@example.com", "someone@example.com", "leaky"].join("\x1f"),
    ].join("\n");
    assert.deepEqual(findViolations(log), ["bbbbbbbbbbbb leaky (uses someone@example.com)"]);
  });
});

describe("range from the GitHub event", () => {
  const always = () => true;
  const never = () => false;
  const Z = "0".repeat(40);

  it("pull request: base..head", () => {
    assert.equal(rangeFromEvent({ pull_request: { base: { sha: "b1" }, head: { sha: "h1" } } }, always), "b1..h1");
  });

  it("push: before..after", () => {
    assert.equal(rangeFromEvent({ before: "b1", after: "a1" }, always), "b1..a1");
  });

  it("first push (before is all zeros) and events without a range check nothing", () => {
    assert.equal(rangeFromEvent({ before: Z, after: "a1" }, always), null);
    assert.equal(rangeFromEvent({}, always), null);
  });

  it("force push: `before` is gone from the clone, so check the pushed tip instead of crashing", () => {
    assert.equal(rangeFromEvent({ before: "b1", after: "a1" }, never), "a1^!");
  });
});

describe("pre-commit hook", () => {
  const isolated = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

  function hookStatus(userEmail: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "hook-"));
    try {
      const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...isolated, ...env } });
      run("git", ["init", "-q"]);
      run("git", ["config", "user.name", "T"]);
      run("git", ["config", "user.email", userEmail]);
      return run("sh", [HOOK]).status;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("passes with a noreply user.email and rejects another one", () => {
    assert.equal(hookStatus(NOREPLY), 0);
    assert.equal(hookStatus("someone@example.com"), 1);
  });

  it("also rejects a personal address set through GIT_AUTHOR_EMAIL or GIT_COMMITTER_EMAIL", () => {
    assert.equal(hookStatus(NOREPLY, { GIT_AUTHOR_EMAIL: "someone@example.com" }), 1);
    assert.equal(hookStatus(NOREPLY, { GIT_COMMITTER_EMAIL: "someone@example.com" }), 1);
  });
});
