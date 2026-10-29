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
};

export type GraphBinding = {
  workflow: WorkflowName;
  inputs: Record<string, GraphInputBinding>;
  /** Logical output name -> node id of the Save* node that produces it. */
  outputs: Record<string, string>;
};

/**
 * A value for a graph input. Images are an uploaded filename / Comfy asset id
 * (string), or an opaque SDK asset handle when applied through `setInput`.
 */
export type GraphValue = string | number | boolean | object;

// ---------------------------------------------------------------------------
// Image references inside JSON pipeline requests
// ---------------------------------------------------------------------------

/**
 * `upload`: the name of a file part in the same multipart request.
 * `assetId`: an existing Comfy asset (e.g. `OutputRef.id` of an earlier job).
 */
export type ImageRef = { upload: string } | { assetId: string };

// ---------------------------------------------------------------------------
// Pipelines (multi-step DAGs: soul, photoshoot, cards, motion)
// ---------------------------------------------------------------------------

export type PipelineKind = "soul" | "photoshoot" | "cards" | "motion";

/** A reference to an earlier step's output, used to wire steps together. */
export type StepInputRef = { fromStep: string; outputNode?: string; index?: number };

/**
 * Per-step status. A superset of JobStatus: `pending` (dependencies not done),
 * `skipped` (not needed / upstream failed), `timed_out` (our per-step deadline
 * elapsed; the Comfy job is NOT resubmitted), `needs_input` (a code step lacks
 * user copy, e.g. a cards tile with no `painPoints`).
 */
export type PipelineStepStatus = JobStatus | "pending" | "skipped" | "timed_out" | "needs_input";

export const TERMINAL_STEP_STATUSES: readonly PipelineStepStatus[] = [
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "skipped",
  "timed_out",
  "needs_input",
];

type PipelineStepBase = {
  id: string;
  dependsOn: readonly string[];
  /**
   * Concrete at plan time: seeds and enhancer prompts are resolved before the
   * run is persisted, so a resumed run never re-plans (docs/spec/api.md §2.0).
   */
  inputs: Record<string, string | number | boolean | StepInputRef>;
  /**
   * REQUIRED wall-clock budget for this step (ms). For a comfy step this is
   * the `pollJob` timeout; on expiry the step becomes `timed_out` and is never
   * auto-resubmitted.
   */
  timeoutMs: number;
  status: PipelineStepStatus;
  /** ISO-8601 timestamps. */
  startedAt?: string;
  /**
   * ISO-8601: `startedAt + timeoutMs`, persisted with `startedAt`. It survives
   * a restart, so a resumed step polls only for the time that remains.
   */
  deadlineAt?: string;
  finishedAt?: string;
  error?: JobErrorInfo | null;
  outputs?: OutputRef[];
};

/**
 * Lifecycle of one submit (docs/spec/api.md §2.0):
 * - `sending`: key minted and persisted; the POST may or may not have landed.
 * - `accepted`: 201 received and `jobId` persisted.
 * - `rejected`: definitive 4xx; the step failed and is never resubmitted.
 * - `unconfirmed`: a same-key re-send got 422 `idempotency_key_reuse` (or the
 *   re-send budget ran out) with no job id stored; never resubmitted.
 */
export type SubmissionState = "sending" | "accepted" | "rejected" | "unconfirmed";

export type StepSubmission = {
  /** Minted once per step and persisted BEFORE the POST; re-sends reuse it. */
  idempotencyKey: string;
  state: SubmissionState;
  /** ISO-8601. Re-sends stop being attempted 23 h after this. */
  mintedAt: string;
  /** POSTs sent under this key (1..3). */
  attempts: number;
  lastError?: JobErrorInfo | null;
};

/** Step error code when a job may exist but its id was lost (see StepSubmission). */
export const SUBMIT_UNCONFIRMED = "submit_unconfirmed" as const;

export type ComfyPipelineStep = PipelineStepBase & {
  kind: "comfy";
  /** Graph in `workflows/` (its binding lives in lib/bindings/<workflow>.ts). */
  workflow: WorkflowName;
  /** Present once a submit has been attempted; persisted before the POST. */
  submission?: StepSubmission;
  /**
   * Persisted as soon as the submit returns 201 (before polling). A resumed
   * run polls this id; it never resubmits a step that has one.
   */
  jobId?: string;
};

export type CodePipelineStep = PipelineStepBase & {
  kind: "code";
  /** Name of an in-process handler (photo QA, crop, compose, render card, ...). */
  workflow: string;
  jobId?: undefined;
};

export type PipelineStep = ComfyPipelineStep | CodePipelineStep;

/** Default per-step budgets (ms). Ours, provisional until Cloud timings exist. */
export const DEFAULT_STEP_TIMEOUT_MS: Record<WorkflowName, number> = {
  image_resize_smoke: 60_000,
  klein_edit_multiref: 180_000,
  klein_t2i: 120_000,
  cutout: 120_000,
  upscale: 300_000,
  h3_r2v: 900_000,
};

/** `partial`: finished, but some steps failed / timed out / need input. */
export type PipelineRunStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "canceled";

export type PipelineRequestMap = {
  soul: SoulRequest;
  photoshoot: PhotoshootRequest;
  cards: CardsRequest;
  motion: MotionRequest;
};

export type PipelineResultMap = {
  soul: SoulResult;
  photoshoot: PhotoshootResult;
  cards: CardsResult;
  motion: MotionResult;
};

export const RUN_SCHEMA = "open-soul-studio/run@1" as const;

/** One durable document per run: `${DATA_DIR:-.data}/runs/<id>.json` (docs/spec/api.md §2.0). */
export type PipelineRun<K extends PipelineKind = PipelineKind> = {
  schema: typeof RUN_SCHEMA;
  id: string;
  kind: K;
  status: PipelineRunStatus;
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
  /** Overall budget (ms); defaults to the sum of the critical path's step timeouts. */
  timeoutMs: number;
  /** 0..1, derived from finished steps (and Comfy progress of running steps). */
  progress: number;
  steps: PipelineStep[];
  /**
   * As persisted: every `{ upload }` ImageRef has already been uploaded and
   * rewritten to `{ assetId }`, so the stored request holds no file parts.
   */
  request: PipelineRequestMap[K];
  /** Present once the run is terminal (possibly partial). */
  result: PipelineResultMap[K] | null;
  error: JobErrorInfo | null;
  /** Set by the cancel route; honoured on reconcile after a restart. */
  cancelRequested?: boolean;
};

// ---------------------------------------------------------------------------
// Soul ID (Instant): curated refs + style card, portable as soul.json
// ---------------------------------------------------------------------------

export const SOUL_SCHEMA = "open-soul-studio/soul@1" as const;
export const SOUL_MIN_REFS = 3;
export const SOUL_MAX_REFS = 6;

/** Pixel rectangle in the source photo (top-left origin). */
export type CropBox = { x: number; y: number; width: number; height: number };

/**
 * One curated reference. Exactly one of `assetId` (Comfy asset, server-side
 * Soul registry) or `path` (relative to soul.json, in an exported bundle).
 */
export type SoulRef = ({ assetId: string; path?: undefined } | { path: string; assetId?: undefined }) & {
  crop: CropBox;
  /** 64-bit perceptual hash, 16 lowercase hex chars; used for near-duplicate rejection. */
  phash: string;
  /**
   * SHA-256 of the ref's PNG file, 64 lowercase hex chars. Integrity check on
   * import, and (with the backend base URL) the key of the asset cache.
   */
  sha256: string;
  /** Photo-QA score 0..1 (higher is better); refs are stored best-first. */
  qaScore?: number;
};

export type StyleTrait = "skinTone" | "hair" | "eyes" | "faceShape" | "ageRange" | "accessories" | "wardrobe";

export type StyleCard = {
  /** Text block appended to every prompt that uses this Soul (≤ 400 chars). */
  description: string;
  traits: Partial<Record<StyleTrait, string>>;
  /** Features that must never change, e.g. "small mole above the left lip". */
  keep: readonly string[];
};

/** The contents of `soul.json`. */
export type Soul = {
  schema: typeof SOUL_SCHEMA;
  id: string;
  name: string;
  /** ISO-8601. */
  createdAt: string;
  /** SOUL_MIN_REFS..SOUL_MAX_REFS crops, best first. */
  refs: SoulRef[];
  styleCard: StyleCard;
};

export type SoulRequest = {
  name: string;
  /** 3–12 candidate photos; QA picks the best 3–6. */
  photos: ImageRef[];
  /** Render an identity preview sheet with klein_edit_multiref (default true). */
  preview?: boolean;
};

export type PhotoQaReason =
  | "no_face"
  | "multiple_faces"
  | "face_too_small"
  | "too_small"
  | "blurry"
  | "duplicate"
  | "unsupported_type";

export type SoulResult = {
  soul: Soul;
  /** Candidate photos not used, by index into `SoulRequest.photos`. */
  rejected: { index: number; reason: PhotoQaReason }[];
  preview: OutputRef | null;
};

// ---------------------------------------------------------------------------
// Pipeline requests / results: Photoshoot, Cards, Motion
// ---------------------------------------------------------------------------

export type PhotoshootRequest = {
  mode: PhotoshootMode;
  /** The user's short intent, never the assembled prompt. */
  prompt: string;
  /** Product photo(s); the first is the hero. Optional only for text-only `product_shot`. */
  images: ImageRef[];
  /** Clamped to the mode's range (with a notice). */
  count: number;
  /** Snapped to the whitelist (with a notice); defaults per mode. */
  aspectRatio?: AspectRatio;
  soulId?: string;
  /** Optional moodboard / "like this" reference (at most 1). */
  styleRef?: ImageRef;
  /** `fast` skips the SeedVR2 upscale. */
  quality?: "fast" | "final";
  /** product_shot only: run the cutout graph on the result. */
  transparent?: boolean;
  seed?: number;
};

export type VariationPick = Record<VariationAxis, string>;

export type PhotoshootItem = {
  index: number;
  seed: number;
  status: PipelineStepStatus;
  variation: VariationPick;
  output: OutputRef | null;
  error: JobErrorInfo | null;
};

export type PhotoshootResult = {
  mode: PhotoshootMode;
  aspectRatio: AspectRatio;
  count: number;
  /** One-line user notices (count clamped, aspect snapped, Soul ignored, ...). */
  notices: string[];
  items: PhotoshootItem[];
};

export type CardTileState = "queued" | "running" | "done" | "needs_input" | "failed";

export type CardsRequest = {
  /** Default `main` when neither scope nor assets is given; `assets` wins over `scope`. */
  scope?: CardScope;
  assets?: CardAssetId[];
  /** Reuse a stored main result instead of regenerating `main_image`. */
  mainJobId?: string;
  /** 1–6; the first is the hero. */
  productImages: ImageRef[];
  productName?: string;
  brandName?: string;
  category?: string;
  bullets?: string[];
  ingredients?: { name: string; amount?: string; benefit?: string }[];
  specs?: { label: string; value: string }[];
  /** 1–3 `#rrggbb`. */
  brandColors?: string[];
  visualStyle?: string;
  tagline?: string;
  logo?: ImageRef;
  boxContents?: { qty: number; name: string; imageIndex?: number }[];
  painPoints?: { problem: string; solution: string }[];
  efficacyClaims?: { value: string; label: string }[];
  efficacySource?: string;
  howToUse?: string[];
  endorsement?: { type: "review" | "expert" | "certification"; text: string; by: string; rightsConfirmed: boolean };
  soulId?: string;
  /** BCP-47. */
  language?: string;
  seed?: number;
};

export type MainImageCheck = { id: string; ok: boolean; level: "error" | "warn"; value?: number; message?: string };

export type MainImageResult = {
  jobId: string;
  compositeUrl: string;
  /** The anchor every secondary / A+ asset is conditioned on. */
  cutoutRgbaUrl: string;
  cutoutBbox: CropBox;
  checks: MainImageCheck[];
  ok: boolean;
};

export type CardTile = {
  asset: CardAssetId;
  state: CardTileState;
  seed: number | null;
  /** App-relative URL of the rendered card (`/api/...`). */
  url: string | null;
  /** Request fields this tile still needs (state `needs_input`). */
  missing: string[];
  error: JobErrorInfo | null;
};

export type CardsResult = {
  /** Assets in output order (main first). */
  assets: CardAssetId[];
  main: MainImageResult | null;
  tiles: CardTile[];
  styleBlock: string;
};

/** Values accepted by `ResolutionSelector.aspect_ratio` in h3_r2v. */
export type MotionAspect = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";

export type MotionRequest = {
  /** `<Picture 1>`: a Soul's best ref, or an uploaded person photo. One is required. */
  soulId?: string;
  personImage?: ImageRef;
  /** `<Picture 2>`. */
  productImage: ImageRef;
  /** User intent; the app adds the `<Picture N>` role tags. */
  prompt: string;
  /** Seconds, ~5–15 (snapped to the 17k+5 frame grid at 24 fps). */
  duration?: number;
  aspectRatio?: MotionAspect;
  /** `preview` = 4-step turbo LoRA; `final` = 20 base steps (default). */
  quality?: "preview" | "final";
  /** `match` (fast) or `max` (best identity, slower). */
  refFidelity?: "match" | "max";
  seed?: number;
};

export type MotionResult = {
  video: OutputRef | null;
  seed: number;
  frames: number;
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
