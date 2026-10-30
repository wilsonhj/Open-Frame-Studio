/**
 * FLUX.2 Klein 4B distilled text-to-image (Cards backdrops, text-only
 * packshot, fixtures).
 *
 * Graph: workflows/klein_t2i.api.json = the shared loaders (59, 2, 3) plus the
 * `p*` chain of spikes/klein-multiref/flux2_klein_t2i_fixtures.api.json; the
 * second fixture chain (`m*`) is dropped and SaveImage p9 is renamed
 * `klein_t2i`. Node ids are unchanged from the spike.
 */
import type { GraphBinding } from "../types.ts";

export const kleinT2i = {
  workflow: "klein_t2i",
  inputs: {
    prompt: { node: "p4", field: "text", kind: "text" },
    /** Multiple of 16; mirrored into Flux2Scheduler. */
    width: { node: "p44", field: "width", kind: "int", mirrors: [{ node: "p71", field: "width" }] },
    height: { node: "p44", field: "height", kind: "int", mirrors: [{ node: "p71", field: "height" }] },
    batch_size: { node: "p44", field: "batch_size", kind: "int" },
    seed: { node: "p70", field: "noise_seed", kind: "int", min: 0, randomize: true },
    steps: { node: "p71", field: "steps", kind: "int" },
    cfg: { node: "p72", field: "cfg", kind: "float" },
    model: { node: "59", field: "unet_name", kind: "text" },
  },
  outputs: { image: "p9" },
} as const satisfies GraphBinding;
