/**
 * Binding registry: which workflows the generic /api/jobs route may run, and
 * how user inputs map onto API-format node ids / fields.
 *
 * Pattern adapted from comfy-openjutsu's typed node maps. Only workflows
 * registered here can be submitted (this also prevents path traversal).
 */
import type { WorkflowBinding } from "../types.ts";

export const BINDINGS: Record<string, WorkflowBinding> = {
  image_resize_smoke: {
    workflow: "image_resize_smoke",
    description: "Plumbing smoke test: LoadImage -> ImageScaleBy -> SaveImage.",
    inputs: {
      image: { node: "1", field: "image", kind: "image", required: true },
      scale: { node: "2", field: "scale_by", kind: "number", default: 0.5, min: 0.05, max: 2 },
      method: {
        node: "2",
        field: "upscale_method",
        kind: "choice",
        default: "lanczos",
        choices: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
      },
    },
    outputNodes: ["3"],
  },
};

export function getBinding(name: string): WorkflowBinding | undefined {
  return Object.hasOwn(BINDINGS, name) ? BINDINGS[name] : undefined;
}
