/** prepareGraph: unused Klein ref slots must not reach Comfy (a LoadImage with no uploaded file fails the job). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyBindings } from "../../lib/bindings/apply.ts";
import { kleinEditMultiref } from "../../lib/bindings/klein_edit_multiref.ts";
import { prepareGraph } from "../../lib/bindings/prepare.ts";
import { loadGraph } from "../../lib/comfy.ts";

const ref = (id: string) => ({ __type: "core/ASSET", info: { id } }) as never;

test("klein_edit_multiref keeps only the ref slots it is given", async () => {
  const graph = await loadGraph("klein_edit_multiref");
  const values = { image_1: ref("a"), image_3: ref("c"), prompt: "x" };
  const prepared = prepareGraph("klein_edit_multiref", graph, values);
  assert.ok(graph["60"] && graph["62"], "the source graph is not mutated");
  for (const unused of ["60", "62"]) assert.equal(prepared[unused], undefined);
  assert.ok(prepared["54"] && prepared["61"]);
  const refs = Object.keys(prepared["17"].inputs).filter((k) => k.startsWith("images."));
  assert.deepEqual(refs.sort(), ["images.image0", "images.image2"]);
  // No input anywhere still points at a removed node.
  for (const node of Object.values(prepared)) {
    for (const v of Object.values(node.inputs)) {
      if (Array.isArray(v)) assert.ok(!["60", "62"].includes(String(v[0])), `dangling link to ${v[0]}`);
    }
  }
  const applied = applyBindings(prepared, kleinEditMultiref, values);
  assert.deepEqual(applied["54"].inputs.image, ref("a"));
  assert.deepEqual(applied["61"].inputs.image, ref("c"));
});

test("all four refs, or another workflow, leave the graph unchanged", async () => {
  const graph = await loadGraph("klein_edit_multiref");
  const all = { image_1: ref("a"), image_2: ref("b"), image_3: ref("c"), image_4: ref("d") };
  assert.equal(prepareGraph("klein_edit_multiref", graph, all), graph);
  const smoke = await loadGraph("image_resize_smoke");
  assert.equal(prepareGraph("image_resize_smoke", smoke, {}), smoke);
});
