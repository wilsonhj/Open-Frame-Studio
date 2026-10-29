/**
 * FLUX.2 Klein 4B distilled multi-reference edit (Soul preview, Photoshoot,
 * Cards secondary / A+ tiles).
 *
 * Graph: workflows/klein_edit_multiref.api.json, a verbatim copy of
 * spikes/klein-multiref/flux2_klein_edit_multiref.api.json.
 * Node ids: docs/spikes/klein-multiref.md:58-83.
 *
 * `image_1..image_4` follow the ReferenceMultiLatent order (images.image0..3),
 * which is what FLUX.2 prompts call "image 1".."image 4" in plain words. The
 * graph always wires all four LoadImage nodes; to use fewer refs, drop the
 * `images.imageN` key and its LoadImage node before submitting.
 */
import type { GraphBinding } from "../types.ts";

export const kleinEditMultiref = {
  workflow: "klein_edit_multiref",
  inputs: {
    image_1: { node: "54", field: "image", kind: "image" },
    image_2: { node: "60", field: "image", kind: "image" },
    image_3: { node: "61", field: "image", kind: "image" },
    image_4: { node: "62", field: "image", kind: "image" },
    prompt: { node: "4", field: "text", kind: "text" },
    /** Multiple of 16; mirrored into Flux2Scheduler. */
    width: { node: "44", field: "width", kind: "int", mirrors: [{ node: "71", field: "width" }] },
    height: { node: "44", field: "height", kind: "int", mirrors: [{ node: "71", field: "height" }] },
    batch_size: { node: "44", field: "batch_size", kind: "int" },
    seed: { node: "70", field: "noise_seed", kind: "int" },
    steps: { node: "71", field: "steps", kind: "int" },
    cfg: { node: "72", field: "cfg", kind: "float" },
    /** Reference resize budget (default 1.0 MP). */
    ref_megapixels: { node: "17", field: "resolution.megapixels", kind: "float" },
    model: { node: "59", field: "unet_name", kind: "text" },
  },
  outputs: { image: "9" },
} as const satisfies GraphBinding;
