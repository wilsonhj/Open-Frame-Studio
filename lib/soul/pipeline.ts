/**
 * STUB (W2.0 skeleton). Owner: slice C (docs/OWNERS.md). Replace the body;
 * keep the export name and type: `soulPipeline: PipelineDefinition<"identity">`
 * (lib/pipeline/types.ts, frozen at contracts-v1).
 */
import type { PipelineDefinition } from "../pipeline/types.ts";

const NOT_IMPLEMENTED = "not implemented: soul pipeline (slice C)";

export const soulPipeline: PipelineDefinition<"identity"> = {
  kind: "identity",
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
