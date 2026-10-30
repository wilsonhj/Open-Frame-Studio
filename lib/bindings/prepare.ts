/**
 * STUB (W2.0 skeleton). Owner: slice B (docs/OWNERS.md). Frozen API at
 * contracts-v1: `prepareGraph(workflow, graph, values)`.
 *
 * Per-workflow structural edits a graph needs for a given set of logical
 * values, applied BEFORE `applyBindings` (e.g. klein_edit_multiref: drop the
 * `images.imageN` key and LoadImage node of every unused `image_N`). Pure:
 * returns a new graph or the same one; never mutates `graph`. The identity
 * for now.
 */
import type { WorkflowName } from "../types.ts";
import type { ApiGraph, BindingValues } from "./apply.ts";

export function prepareGraph<G extends ApiGraph>(workflow: WorkflowName, graph: G, values: BindingValues): G {
  void workflow;
  void values;
  return graph;
}
