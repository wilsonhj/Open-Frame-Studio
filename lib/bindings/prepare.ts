/**
 * Per-workflow structural edits a graph needs for a given set of logical
 * values, applied BEFORE `applyBindings`. Frozen API at contracts-v1:
 * `prepareGraph(workflow, graph, values)`. Pure: returns a new graph or the
 * same one; never mutates `graph`.
 *
 * klein_edit_multiref: the graph always wires four LoadImage refs into
 * ReferenceMultiLatent (node 17, `images.image0..3`). Comfy rejects a
 * LoadImage whose file was never uploaded, so every unused optional
 * `image_N` loses its `images.imageN` key and its LoadImage node
 * (docs/spikes/klein-multiref.md).
 */
import type { WorkflowName } from "../types.ts";
import type { ApiGraph, BindingValues } from "./apply.ts";
import { kleinEditMultiref } from "./klein_edit_multiref.ts";

/** Optional ref slots, in ReferenceMultiLatent order (image_1 is required). */
const KLEIN_OPTIONAL_REFS = [
  { input: "image_2", key: "images.image1" },
  { input: "image_3", key: "images.image2" },
  { input: "image_4", key: "images.image3" },
] as const;

/** The ReferenceMultiLatent node: the one consuming image_1's LoadImage. */
const KLEIN_REFERENCE_NODE = "17";

export function prepareGraph<G extends ApiGraph>(workflow: WorkflowName, graph: G, values: BindingValues): G {
  if (workflow !== "klein_edit_multiref") return graph;
  const unused = KLEIN_OPTIONAL_REFS.filter((slot) => values[slot.input] === undefined);
  if (unused.length === 0) return graph;
  const next = structuredClone(graph) as ApiGraph;
  const reference = next[KLEIN_REFERENCE_NODE];
  for (const slot of unused) {
    delete next[kleinEditMultiref.inputs[slot.input].node];
    if (reference) delete reference.inputs[slot.key];
  }
  return next as G;
}
