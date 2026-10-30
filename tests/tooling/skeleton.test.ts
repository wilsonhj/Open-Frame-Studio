/** W2.0 skeleton seams (orchestrator-owned): the registry resolves every kind. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PIPELINES, PIPELINE_KINDS, getPipeline, isPipelineKind } from "../../lib/pipeline/kinds.ts";

test("every PipelineKind has a registered definition with a matching kind", () => {
  assert.deepEqual([...PIPELINE_KINDS].sort(), Object.keys(PIPELINES).sort());
  for (const kind of PIPELINE_KINDS) {
    assert.equal(getPipeline(kind).kind, kind);
    assert.equal(typeof getPipeline(kind).validate, "function");
  }
  assert.equal(isPipelineKind("soul"), true);
  assert.equal(isPipelineKind("nope"), false);
  assert.equal(getPipeline("nope"), undefined);
});
