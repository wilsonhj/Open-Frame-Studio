/**
 * Shared contract types for the studio.
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
// Pipelines (multi-step DAGs: identity, photoshoot, listing, motion)
// ---------------------------------------------------------------------------

export type PipelineKind = "identity" | "photoshoot" | "listing" | "motion";

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
//
// Our own model, not a fixed list of named modes: a shoot is a SHOT STYLE
// (what the picture is) times an OUTPUT FORMAT (how many, what shape, how
// consistent). Styles and formats compose, so "with_person" x "series" is a
// consistent set of on-person shots without a dedicated mode for it.
// ---------------------------------------------------------------------------

export const SHOT_STYLES = [
  /** Product alone on a clean, seamless backdrop. */
  "packshot",
  /** Product placed in a believable real-world setting. */
  "in_context",
  /** Product held, worn or used by a person (an identity or uploaded photos). */
  "with_person",
  /** Top-down arrangement with props. */
  "flat_lay",
  /** Stylised or surreal art-directed scene. */
  "concept",
  /** Keep the composition of an existing photo; change light, palette or setting. */
  "restage",
] as const;

export type ShotStyle = (typeof SHOT_STYLES)[number];

export const OUTPUT_FORMATS = [
  /** 1-4 independent variations. */
  "single",
  /** 3-10 frames that share one locked style (for carousels and lookbooks). */
  "series",
  /** One wide image with clear space for a headline. */
  "banner",
  /** The same shot cropped and recomposed for several placements. */
  "ad_set",
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type VariationAxis = "setting" | "lighting" | "angle" | "palette";

export type ShotTemplate = {
  style: ShotStyle;
  label: string;
  /** Prompt template with `{product}`, `{setting}`, `{lighting}`, `{angle}`, `{palette}` slots. */
  promptTemplate: string;
  variationAxes: readonly VariationAxis[];
  /** Needs a person reference (a saved identity or uploaded photos). */
  needsPerson: boolean;
};

export type FormatTemplate = {
  format: OutputFormat;
  label: string;
  defaultAspect: AspectRatio;
  /** Subset of ASPECT_RATIOS the format accepts. */
  aspects: readonly AspectRatio[];
  minOutputs: number;
  maxOutputs: number;
  /** All outputs share one style lock (seed, palette, lighting). */
  sharedStyle: boolean;
};

// ---------------------------------------------------------------------------
// Listing images (marketplace product pages)
//
// A HERO image on pure white anchors everything; GALLERY slots show the
// product itself; STORY slots are the long-form brand panels further down a
// product page. Text is always rendered in code, never by diffusion.
// ---------------------------------------------------------------------------

export const LISTING_SLOTS = [
  "hero",
  "gallery_callouts",
  "gallery_angles",
  "gallery_detail",
  "gallery_in_use",
  "gallery_contents",
  "story_banner",
  "story_problem_solution",
  "story_feature_grid",
  "story_how_to",
  "story_specs",
] as const;

export type ListingSlotId = (typeof LISTING_SLOTS)[number];

export type ListingScope = "hero" | "gallery" | "story" | "complete";

export type ListingSlot = {
  id: ListingSlotId;
  label: string;
  /** Every non-hero slot is conditioned on the hero image. */
  anchoredOnHero: boolean;
  aspect: AspectRatio;
  /** Copy rendered in code (never by diffusion). Empty for the hero. */
  textSlots: readonly string[];
  scopes: readonly ListingScope[];
};
