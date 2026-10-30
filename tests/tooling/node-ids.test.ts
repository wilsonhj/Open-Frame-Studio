/**
 * docs/PLAN.md freeze rule: tool slices and UI never use Comfy node ids. They
 * address graphs through logical binding names (lib/bindings/*); only
 * lib/bindings and the runtime map those to node ids.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOTS = ["lib/photoshoot", "lib/cards", "lib/enhancer", "lib/motion", "lib/soul", "components"];

/** A quoted numeric node id in a node-addressing position, or a graph indexed by one. */
const NODE_ID_PATTERNS = [
  /\b(?:node|nodeId|outputNode|node_id)\s*(?::|===?|!==?)\s*["'`]\d+["'`]/,
  /\b(?:graph|workflow|prompt)\s*\[\s*["'`]\d+["'`]\s*\]/,
];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // a slice that has not landed yet
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

test("tool slices and components use no Comfy node ids", () => {
  const hits: string[] = [];
  for (const file of ROOTS.flatMap(sourceFiles)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (NODE_ID_PATTERNS.some((p) => p.test(line))) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, [], `node ids outside lib/bindings:\n${hits.join("\n")}`);
});

test("the guard catches a node id", () => {
  assert.ok(NODE_ID_PATTERNS.some((p) => p.test(`const ref = { fromStep: "cutout", outputNode: "18" };`)));
  assert.ok(NODE_ID_PATTERNS.some((p) => p.test(`graph["54"].inputs.image = id;`)));
  assert.ok(!NODE_ID_PATTERNS.some((p) => p.test(`outputNode: "cutout"`)));
});
