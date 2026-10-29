/**
 * Shared contract types for Open Soul Studio.
 *
 * These are the Wave-0 drafts of the contracts that freeze at the end of
 * Wave 1 (see docs/PLAN.md). Keep this file free of runtime dependencies so
 * both server and client code (and `node --test`) can import it.
 */

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * Normalized job status. The Comfy API v2 reports
 * queued|running|canceling|succeeded|canceled|failed|expired; a self-hosted
 * comfy-api-proxy can additionally report `unknown` (possibly forever).
 * Anything unrecognised maps to `unknown`.
 */
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired"
  | "unknown";

export const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "canceled", "expired"];

export type JobErrorInfo = {
  code: string;
  message: string;
  nodeId?: string | null;
  classType?: string | null;
};

/** A job output as exposed to the browser: re-hosted through our own route. */
export type OutputRef = {
  /** Comfy asset id of the output. */
  id: string;
  jobId: string;
  /** API-format node id that produced it (empty if the worker named none). */
  nodeId: string;
  name: string;
  type: "image" | "video" | "audio" | "text" | "file" | "latent";
  contentType: string;
  sizeBytes: number;
  /** App-relative URL: `/api/jobs/{jobId}/outputs/{id}` (never a signed URL). */
  url: string;
};

export type Job = {
  id: string;
  status: JobStatus;
  /**
   * True when the app should stop polling: a terminal Comfy status, or our
   * own poll deadline elapsed while the job sat in `unknown`/non-terminal.
   */
  terminal: boolean;
  /** 0..1 when the server reports progress. */
  progress: number | null;
  queuePosition: number | null;
  outputs: OutputRef[];
  error: JobErrorInfo | null;
};

// ---------------------------------------------------------------------------
// Workflow bindings (input name -> API-format node id + field)
// ---------------------------------------------------------------------------

export type BindingKind = "image" | "text" | "number" | "integer" | "boolean" | "choice";

export type InputBinding = {
  /** API-format node id, e.g. "54". */
  node: string;
  /** Input field on that node, e.g. "image" or "text". */
  field: string;
  kind: BindingKind;
  required?: boolean;
  /** Default applied when the field is absent (non-image kinds only). */
  default?: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  choices?: readonly string[];
};

export type WorkflowBinding = {
  /** Loads `workflows/<workflow>.api.json`. */
  workflow: string;
  description: string;
  inputs: Record<string, InputBinding>;
  /** Node ids whose outputs the UI should show (e.g. SaveImage ids). */
  outputNodes: readonly string[];
};

// ---------------------------------------------------------------------------
// Pipelines (multi-step DAGs: soul, photoshoot, cards, motion)
// ---------------------------------------------------------------------------

export type PipelineKind = "soul" | "photoshoot" | "cards" | "motion";

/** A reference to an earlier step's output, used to wire steps together. */
export type StepInputRef = { fromStep: string; outputNode?: string; index?: number };

export type PipelineStep = {
  id: string;
  /** Binding registry key (see lib/bindings). Steps that run in code use `kind: "code"`. */
  workflow: string;
  kind: "comfy" | "code";
  dependsOn: readonly string[];
  inputs: Record<string, string | number | boolean | StepInputRef>;
  status?: JobStatus | "pending" | "skipped";
  jobId?: string;
  outputs?: OutputRef[];
};

// ---------------------------------------------------------------------------
// Product Photoshoot
// ---------------------------------------------------------------------------

export const PHOTOSHOOT_MODES = [
  "product_shot",
  "lifestyle_scene",
  "closeup_product_with_person",
  "moodboard_pin",
  "hero_banner",
  "social_carousel",
  "ad_creative_pack",
  "virtual_model_tryout",
  "conceptual_product",
  "restyle",
] as const;

export type PhotoshootMode = (typeof PHOTOSHOOT_MODES)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type VariationAxis = "preset" | "lighting" | "angle" | "palette";

export type ModeTemplate = {
  mode: PhotoshootMode;
  label: string;
  defaultAspect: AspectRatio;
  /** Subset of ASPECT_RATIOS the mode accepts. */
  aspects: readonly AspectRatio[];
  minOutputs: number;
  maxOutputs: number;
  /** Prompt template with `{product}`, `{style}`, `{lighting}`, `{angle}`, `{palette}` slots. */
  promptTemplate: string;
  variationAxes: readonly VariationAxis[];
  /** Carousel-style modes share one style lock across all outputs. */
  sharedStyle: boolean;
  /** Needs a person reference (Soul ID or photos). */
  needsPerson: boolean;
};

// ---------------------------------------------------------------------------
// Marketplace Cards
// ---------------------------------------------------------------------------

export const CARD_ASSETS = [
  "main_image",
  "infographic",
  "multi_angle",
  "detail_shot",
  "lifestyle",
  "whats_in_box",
  "aplus_hero_banner",
  "aplus_pain_points",
  "aplus_features",
  "aplus_ingredients",
  "aplus_efficacy",
  "aplus_how_to_use",
  "aplus_endorsement",
] as const;

export type CardAssetId = (typeof CARD_ASSETS)[number];

export type CardScope = "main" | "product-images" | "aplus" | "full-set";

export type CardAsset = {
  id: CardAssetId;
  label: string;
  /** Every non-main asset is conditioned on the main image. */
  anchoredOnMain: boolean;
  aspect: AspectRatio;
  /** Copy rendered in code (never by diffusion). Empty for main_image. */
  textSlots: readonly string[];
  scopes: readonly CardScope[];
};
