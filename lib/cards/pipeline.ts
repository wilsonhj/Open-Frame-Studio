/**
 * STUB (W2.0 skeleton). Owner: slice E (docs/OWNERS.md). Replace the body;
 * keep the export name and type: `cardsPipeline: PipelineDefinition<"cards">`
 * (lib/pipeline/types.ts, frozen at contracts-v1).
 */
import type { PipelineDefinition } from "../pipeline/types.ts";

const NOT_IMPLEMENTED = "not implemented: cards pipeline (slice E)";

export const cardsPipeline: PipelineDefinition<"cards"> = {
  kind: "cards",
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
