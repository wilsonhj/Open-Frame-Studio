/**
 * Plumbing smoke test: LoadImage -> ImageScaleBy -> SaveImage (the /smoke page).
 *
 * Graph: workflows/image_resize_smoke.api.json. Defaults (scale 0.5,
 * lanczos) live in the graph; the form only overrides what it sends.
 */
import type { GraphBinding } from "../types.ts";

export const imageResizeSmoke = {
  workflow: "image_resize_smoke",
  inputs: {
    image: { node: "1", field: "image", kind: "image", required: true },
    scale: { node: "2", field: "scale_by", kind: "float", min: 0.05, max: 2 },
    method: {
      node: "2",
      field: "upscale_method",
      kind: "text",
      choices: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
    },
  },
  outputs: { image: "3" },
} as const satisfies GraphBinding;
