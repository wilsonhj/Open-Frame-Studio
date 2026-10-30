/**
 * STUB (W2.0 skeleton). Owner: slice F (docs/OWNERS.md). Replace the body;
 * keep the export name and type: `motionPipeline: PipelineDefinition<"motion">`
 * (lib/pipeline/types.ts, frozen at contracts-v1).
 */
import type { PipelineDefinition } from "../pipeline/types.ts";

const NOT_IMPLEMENTED = "not implemented: motion pipeline (slice F)";

export const motionPipeline: PipelineDefinition<"motion"> = {
  kind: "motion",
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
