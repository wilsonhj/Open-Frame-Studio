/**
 * Binding registry: every workflow in `workflows/` and how its logical inputs
 * map onto API-format node ids / fields (one GraphBinding per workflow).
 *
 * Pattern adapted from comfy-openjutsu's typed node maps. Only workflows
 * registered here can be submitted (this also prevents path traversal).
 */
import type { GraphBinding, WorkflowName } from "../types.ts";
import { cutout } from "./cutout.ts";
import { h3R2v } from "./h3_r2v.ts";
import { imageResizeSmoke } from "./image_resize_smoke.ts";
import { kleinEditMultiref } from "./klein_edit_multiref.ts";
import { kleinT2i } from "./klein_t2i.ts";
import { upscale } from "./upscale.ts";

export const BINDINGS: Record<WorkflowName, GraphBinding> = {
  image_resize_smoke: imageResizeSmoke,
  klein_edit_multiref: kleinEditMultiref,
  klein_t2i: kleinT2i,
  cutout,
  upscale,
  h3_r2v: h3R2v,
};

export function getBinding(name: string): GraphBinding | undefined {
  return Object.hasOwn(BINDINGS, name) ? BINDINGS[name as WorkflowName] : undefined;
}

/** Inputs the server randomizes per run when the request leaves them out (seeds). */
export function seedInputs(binding: GraphBinding): string[] {
  return Object.entries(binding.inputs)
    .filter(([, input]) => input.randomize)
    .map(([name]) => name);
}
