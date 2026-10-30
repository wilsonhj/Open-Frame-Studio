/**
 * BiRefNet background removal -> RGBA cutout (+ mask).
 *
 * Graph: workflows/cutout.api.json, a verbatim copy of
 * spikes/cutout-upscale/cutout.api.json. Node ids: docs/spikes/cutout-upscale.md:32-37.
 */
import type { GraphBinding } from "../types.ts";

export const cutout = {
  workflow: "cutout",
  inputs: {
    image: { node: "17", field: "image", kind: "image", required: true },
  },
  outputs: { cutout: "18", mask: "21" },
} as const satisfies GraphBinding;
