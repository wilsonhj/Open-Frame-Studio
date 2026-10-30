/** Commit identity rule (CLAUDE.md): only GitHub noreply addresses. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-expect-error -- plain ESM script without type declarations
import { findViolations, isAllowedEmail } from "../../scripts/check-commit-identity.mjs";

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
