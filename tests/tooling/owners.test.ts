/**
 * Ownership tooling (orchestrator-owned): scripts/check-owners.mjs and
 * scripts/check-models.mjs. Offline; runs git read-only.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const ROOT = process.cwd();

type Owner = { id: string; include: RegExp[]; exclude: RegExp[] };
type OwnersModule = {
  parseOwners(markdown: string): Owner[];
  ownersOf(path: string, owners: Owner[]): string[];
  sliceFromBranch(branch: string): string | null;
  expandBraces(glob: string): string[];
};
type ModelsModule = {
  referencedModels(): Map<string, Set<string>>;
  checkModels(manifest: unknown, refs: Map<string, Set<string>>): { problems: string[]; warnings: string[] };
};

const ownersPath = pathToFileURL(join(ROOT, "scripts/check-owners.mjs")).href;
const modelsPath = pathToFileURL(join(ROOT, "scripts/check-models.mjs")).href;

test("every tracked file has exactly one owner", () => {
  const out = execFileSync(process.execPath, ["scripts/check-owners.mjs", "--audit"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /each with exactly one owner/);
});

test("ownership globs: excludes, braces and the PLAN's seams", async () => {
  const mod = (await import(ownersPath)) as OwnersModule;
  const owners = mod.parseOwners(readFileSync(join(ROOT, "docs/OWNERS.md"), "utf8"));
  const owner = (p: string) => mod.ownersOf(p, owners).join(",");
  assert.equal(owner("lib/pipeline/runner.ts"), "A");
  assert.equal(owner("lib/pipeline/types.ts"), "orchestrator");
  assert.equal(owner("lib/pipeline/kinds.ts"), "orchestrator");
  assert.equal(owner("app/api/pipelines/[kind]/route.ts"), "A");
  assert.equal(owner("app/api/souls/route.ts"), "C");
  assert.equal(owner("lib/soul/registry.ts"), "C");
  assert.equal(owner("lib/bindings/prepare.ts"), "B");
  assert.equal(owner("models/manifest.json"), "B");
  assert.equal(owner("assets/fonts/Inter_400Regular.ttf"), "E");
  assert.equal(owner("components/ui/button.tsx"), "G");
  assert.equal(owner("tests/e2e/shell.spec.ts"), "G");
  assert.equal(owner("tests/e2e/cards.spec.ts"), "E");
  assert.equal(owner("lib/contracts/pipeline.ts"), "orchestrator");
  assert.deepEqual(mod.expandBraces("a/{b,c}/{d,e}.ts"), ["a/b/d.ts", "a/b/e.ts", "a/c/d.ts", "a/c/e.ts"]);
});

test("slice detection from branch names", async () => {
  const mod = (await import(ownersPath)) as OwnersModule;
  assert.equal(mod.sliceFromBranch("w2/c-registry"), "C");
  assert.equal(mod.sliceFromBranch("w2/E1-main"), "E");
  assert.equal(mod.sliceFromBranch("w2/a"), "A");
  assert.equal(mod.sliceFromBranch("w2/cards"), null);
  assert.equal(mod.sliceFromBranch("wave2"), null);
  assert.equal(mod.sliceFromBranch("w2/h-x"), null);
});

test("models manifest covers every workflow model file", async () => {
  const mod = (await import(modelsPath)) as ModelsModule;
  const manifest = JSON.parse(readFileSync(join(ROOT, "models/manifest.json"), "utf8"));
  const refs = mod.referencedModels();
  assert.ok(refs.size > 0);
  assert.deepEqual(mod.checkModels(manifest, refs).problems, []);
  const missing = mod.checkModels({ models: [] }, refs).problems;
  assert.equal(missing.length, refs.size);
});
