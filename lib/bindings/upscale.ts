/**
 * SeedVR2 image upscale (RGB or RGBA; alpha is re-attached).
 *
 * Graph: workflows/upscale.api.json = spikes/cutout-upscale/upscale.api.json
 * with `52.unet_name` switched from 7B to `seedvr2_3b_int8_convrot.safetensors`
 * (PLAN "Update after Wave 0": SeedVR2 3B + wavelet). Node ids:
 * docs/spikes/cutout-upscale.md:32-43.
 */
import type { GraphBinding } from "../types.ts";

export const upscale = {
  workflow: "upscale",
  inputs: {
    image: { node: "1", field: "image", kind: "image" },
    /** 2.0 by default; 4.0 for 512 -> 2048. */
    scale: { node: "57", field: "resize_type.multiplier", kind: "float" },
    model: { node: "52", field: "unet_name", kind: "text" },
    seed: { node: "54", field: "seed", kind: "int" },
    /** `wavelet` by default (`lab` streaks flat colour). */
    color_correction: { node: "59", field: "color_correction_method", kind: "text" },
  },
  outputs: { image: "9" },
} as const satisfies GraphBinding;
