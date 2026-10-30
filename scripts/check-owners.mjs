#!/usr/bin/env node
/**
 * Path-ownership check for Wave 2 slices (docs/OWNERS.md). Orchestrator-owned.
 *
 *   node scripts/check-owners.mjs <A-G|orchestrator|auto> [base]
 *   node scripts/check-owners.mjs --audit
 *
 * `<slice> [base]`: fails if `git diff --name-only <base>...HEAD` touches a
 * path the slice does not own. `auto`: slice from $OWNER_SLICE or from the
 * branch name `w2/<letter>...` ($GITHUB_HEAD_REF, $GITHUB_REF_NAME, then
 * `git branch --show-current`); base from $OWNERS_BASE (default origin/main).
 * No slice detected → "skipped", exit 0.
 * `--audit`: every tracked file must have exactly one owner.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OWNER_IDS = ["A", "B", "C", "D", "E", "F", "G", "orchestrator"];

/** Expand `{a,b}` groups (nesting allowed). */
export function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open < 0) return [glob];
  let depth = 0;
  let close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return [glob];
  const parts = [];
  let start = open + 1;
  depth = 0;
  for (let i = open + 1; i < close; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}") depth--;
    else if (glob[i] === "," && depth === 0) {
      parts.push(glob.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(glob.slice(start, close));
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return parts.flatMap((p) => expandBraces(head + p + tail));
}

/** Glob → RegExp: `**` any depth, `*` one segment, `?` one char. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Parse the ownership table of docs/OWNERS.md → [{ id, include: RegExp[], exclude: RegExp[] }]. */
export function parseOwners(markdown) {
  const owners = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || !OWNER_IDS.includes(cells[1])) continue;
    const globs = [...cells[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const include = [];
    const exclude = [];
    for (const g of globs) {
      const negated = g.startsWith("!");
      for (const expanded of expandBraces(negated ? g.slice(1) : g)) {
        (negated ? exclude : include).push(globToRegExp(expanded));
      }
    }
    owners.push({ id: cells[1], include, exclude });
  }
  return owners;
}

export function ownersOf(path, owners) {
  return owners
    .filter((o) => o.include.some((r) => r.test(path)) && !o.exclude.some((r) => r.test(path)))
    .map((o) => o.id);
}

function loadOwners() {
  const owners = parseOwners(readFileSync(join(ROOT, "docs/OWNERS.md"), "utf8"));
  const missing = OWNER_IDS.filter((id) => !owners.some((o) => o.id === id));
  if (missing.length) throw new Error(`docs/OWNERS.md: no row for ${missing.join(", ")}`);
  return owners;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

export function sliceFromBranch(branch) {
  const m = /^w2\/([a-g])(?![a-z])/i.exec(branch ?? "");
  return m ? m[1].toUpperCase() : null;
}

function detectSlice() {
  if (process.env.OWNER_SLICE) return process.env.OWNER_SLICE;
  for (const b of [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME]) {
    const s = sliceFromBranch(b);
    if (s) return s;
  }
  try {
    return sliceFromBranch(git(["branch", "--show-current"]).trim());
  } catch {
    return null;
  }
}

function audit() {
  const owners = loadOwners();
  const files = git(["ls-files"]).split("\n").filter(Boolean);
  const problems = [];
  for (const f of files) {
    const ids = ownersOf(f, owners);
    if (ids.length === 0) problems.push(`unowned: ${f}`);
    else if (ids.length > 1) problems.push(`owned by ${ids.join(" and ")}: ${f}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(`check-owners --audit: ${problems.length} problem(s) in ${files.length} tracked files`);
    process.exit(1);
  }
  console.log(`check-owners --audit ok: ${files.length} tracked files, each with exactly one owner`);
}

function check(sliceArg, baseArg) {
  let slice = sliceArg;
  if (slice === "auto") {
    slice = detectSlice();
    if (!slice) {
      console.log("check-owners: skipped (no slice: set OWNER_SLICE or use a w2/<slice>... branch)");
      return;
    }
  }
  if (slice !== "orchestrator") slice = slice.toUpperCase();
  if (!OWNER_IDS.includes(slice)) {
    console.error(`check-owners: unknown slice "${sliceArg}" (expected A-G or orchestrator)`);
    process.exit(2);
  }
  const base = baseArg ?? process.env.OWNERS_BASE ?? "origin/main";
  const owners = loadOwners();
  const changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  const outside = changed
    .map((f) => ({ f, ids: ownersOf(f, owners) }))
    .filter(({ ids }) => !ids.includes(slice));
  if (outside.length) {
    console.error(`check-owners: slice ${slice} changed ${outside.length} path(s) it does not own (base ${base}):`);
    for (const { f, ids } of outside) console.error(`  ${f}  (owner: ${ids.join(", ") || "none"})`);
    console.error("Request changes to these paths in your handback instead (docs/OWNERS.md).");
    process.exit(1);
  }
  console.log(`check-owners ok: slice ${slice}, ${changed.length} changed path(s) since ${base}, all owned`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [first, second] = process.argv.slice(2);
  if (first === "--audit") audit();
  else if (!first) {
    console.error("usage: check-owners.mjs <A-G|orchestrator|auto> [base] | --audit");
    process.exit(2);
  } else check(first, second);
}
