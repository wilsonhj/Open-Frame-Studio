/**
 * STUB (W2.0 skeleton). Owner: slice D (docs/OWNERS.md). Replace the body;
 * keep the export name and type: `photoshootPipeline: PipelineDefinition<"photoshoot">`
 * (lib/pipeline/types.ts, frozen at contracts-v1).
 */
import type { PipelineDefinition } from "../pipeline/types.ts";

const NOT_IMPLEMENTED = "not implemented: photoshoot pipeline (slice D)";

export const photoshootPipeline: PipelineDefinition<"photoshoot"> = {
  kind: "photoshoot",
  validate() {
    return { ok: false, error: NOT_IMPLEMENTED, field: "" };
  },
  async plan() {
    throw new Error(NOT_IMPLEMENTED);
  },
  handlers: {},
  async buildResult() {
    throw new Error(NOT_IMPLEMENTED);
  },
};
