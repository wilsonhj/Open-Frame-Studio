/**
 * Contracts: workflow names and graph bindings (part of the frozen Wave 1
 * contract; barrel: lib/types.ts). Type-only SDK imports; no runtime dependencies.
 */
import type { Asset } from "@comfyorg/sdk";
import type { AssetReference } from "@comfyorg/sdk/low";

// ---------------------------------------------------------------------------
// Graph bindings (frozen in Wave 1): logical name -> API-format node + field
// for the Wave 2 graphs in workflows/<WorkflowName>.api.json.
// See lib/bindings/<workflow>.ts and lib/bindings/apply.ts.
// ---------------------------------------------------------------------------

/** Every API-format graph shipped in `workflows/`. */
export const WORKFLOW_NAMES = [
  "image_resize_smoke",
  "klein_edit_multiref",
  "klein_t2i",
  "cutout",
  "upscale",
  "h3_r2v",
] as const;

export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

export type GraphValueKind = "image" | "text" | "int" | "float" | "bool";

/** A node field in an API-format graph. */
export type GraphTarget = { node: string; field: string };

export type GraphInputBinding = GraphTarget & {
  kind: GraphValueKind;
  /**
   * Extra fields that must always hold the same value (e.g. Klein's
   * `EmptyFlux2LatentImage.width` and `Flux2Scheduler.width`).
   */
  mirrors?: readonly GraphTarget[];
  /** Form input only: reject a submit that omits it (`/api/jobs`, lib/inputs.ts). */
  required?: boolean;
  /** Inclusive bounds for `int` / `float` values. */
  min?: number;
  max?: number;
  /** Allowed values for a `text` input (e.g. a COMBO widget's options). */
  choices?: readonly string[];
  /**
   * `int` seed widgets: when the form omits the value, /api/jobs fills a fresh
   * random one in [min ?? 0, max ?? MAX_SAFE_INTEGER] and returns it in
   * `SubmittedJob.seeds`, so the UI can show and lock it. ComfyUI caches
   * identical graphs, so a fixed graph seed would return the cached result.
   */
  randomize?: boolean;
};

export type GraphBinding = {
  workflow: WorkflowName;
  inputs: Record<string, GraphInputBinding>;
  /** Logical output name -> node id of the Save* node that produces it. */
  outputs: Record<string, string>;
};

/**
 * A non-string image value (@comfyorg/sdk 0.5.0): either a lazy SDK `Asset`
 * handle (`client.assets.fromBytes(...)` / `fromFile(...)`; hashed, deduped
 * and uploaded at submit, then substituted into the graph), or the resolved
 * `core/ASSET` reference object the SDK places where a filename would go:
 * `{ __type: "core/ASSET", info: { id, hash?, file_path? } }`.
 * Either must be set on a loader node's file widget.
 */
export type AssetHandle = Asset | AssetReference;

/**
 * A value for a graph input. Images are an uploaded filename / Comfy asset id
 * (string), or an AssetHandle.
 */
export type GraphValue = string | number | boolean | AssetHandle;
