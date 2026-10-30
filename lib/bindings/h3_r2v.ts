/**
 * MiniMax H3 reference-to-video (person + product presenter clip with audio).
 *
 * Graph: workflows/h3_r2v.api.json, a verbatim copy of
 * spikes/h3-r2v/h3_r2v.api.json (turbo on, 4 steps). Node ids:
 * docs/spikes/h3-r2v.md:62-76. For final renders set `turbo=false`
 * (20 base steps; PLAN "Update after Wave 0").
 */
import type { GraphBinding, MotionAspect } from "../types.ts";

export const h3R2v = {
  workflow: "h3_r2v",
  inputs: {
    /** `<Picture 1>`: person / identity ref. */
    image_1: { node: "137", field: "image", kind: "image", required: true },
    /** `<Picture 2>`: product. */
    image_2: { node: "139", field: "image", kind: "image" },
    /** Must use the `<Picture N>` tags and give each reference a role. */
    prompt: { node: "138", field: "value", kind: "text" },
    seed: { node: "129", field: "noise_seed", kind: "int" },
    /** Seconds; node 131 snaps it to the 17k+5 frame grid at 24 fps. */
    duration: { node: "132", field: "value", kind: "float" },
    /** true = 4-step turbo LoRA, false = base steps. */
    turbo: { node: "146", field: "value", kind: "bool" },
    steps_base: { node: "143", field: "value", kind: "int" },
    steps_turbo: { node: "144", field: "value", kind: "int" },
    /** A ResolutionSelector option, e.g. "9:16 (Portrait Widescreen)". */
    aspect_ratio: { node: "115", field: "aspect_ratio", kind: "text" },
    megapixels: { node: "115", field: "megapixels", kind: "float" },
    /** `match` (fast) or `max` (best identity, slower). */
    ref_image_size: { node: "136", field: "ref_image_size", kind: "text" },
  },
  outputs: { video: "92" },
} as const satisfies GraphBinding;

/** MotionRequest.aspectRatio -> ResolutionSelector option (Cloud object_info). */
export const H3_ASPECT_OPTIONS: Record<MotionAspect, string> = {
  "1:1": "1:1 (Square)",
  "2:3": "2:3 (Portrait Photo)",
  "3:2": "3:2 (Photo)",
  "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)",
  "9:16": "9:16 (Portrait Widescreen)",
  "16:9": "16:9 (Widescreen)",
};
