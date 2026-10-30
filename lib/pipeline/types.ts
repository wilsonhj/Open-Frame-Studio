/**
 * FROZEN at contracts-v1 (orchestrator-owned; see docs/OWNERS.md).
 *
 * The seam between the pipeline runtime (slice A: lib/pipeline/**, routes,
 * store) and the four tool slices (C soul, D photoshoot, E cards, F motion).
 * Each tool exports one `PipelineDefinition<K>` from lib/<kind>/pipeline.ts;
 * lib/pipeline/kinds.ts registers them. The runtime never imports a tool's
 * internals, and a tool never imports the runtime: everything a tool needs at
 * run time arrives through the contexts below.
 *
 * Built on lib/contracts/pipeline.ts (PipelineStep, PipelineRun, ...). Type-only:
 * no runtime code, so server, client and `node --test` can all import it.
 * Changes after contracts-v1 are additive only, applied by the orchestrator.
 */
import type {
  CodePipelineStep,
  ImageRef,
  JobErrorInfo,
  JsonValue,
  OutputRef,
  PipelineKind,
  PipelineRequestMap,
  PipelineResultMap,
  PipelineRun,
  PipelineStep,
  StepInputRef,
} from "../types.ts";

export type { PipelineKind, PipelineRequestMap, PipelineResultMap, PipelineRun, PipelineStep } from "../types.ts";

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/**
 * Result of `validate(raw)`. On failure the route answers
 * `400 { error, field }`, where `field` is a JSON path such as `bullets[2]`
 * (docs/spec/api.md §2). Validation runs before any upload or submit.
 *
 * On success `value` may still hold `{ upload }` ImageRefs: the runtime uploads
 * every `{ upload: name }` it finds in `value` and rewrites it to
 * `{ assetId }` before calling `plan` (the persisted request holds no file parts).
 */
export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: string };

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

/** Supplied by the runtime to `plan` (and to action handlers that re-plan). */
export type PlanContext = {
  /** Id of the run being planned (already minted, not yet persisted). */
  runId: string;
  /** ISO-8601 "now" for the whole plan (use instead of `new Date()`). */
  now: string;
  /**
   * A fresh random seed in 0..2^32-1. Seeds are resolved at plan time and
   * stored in step inputs, so a resumed run never re-plans.
   */
  randomSeed(): number;
};

// ---------------------------------------------------------------------------
// handlers (code steps)
// ---------------------------------------------------------------------------

/** Something a step can read bytes from: a stored request image, or an earlier step's output. */
export type ByteSource = { assetId: string } | StepInputRef;

/**
 * I/O the runtime lends to code handlers and actions. Implemented by slice A;
 * tools must not touch `.data/` or the Comfy client directly.
 */
export type RunIo = {
  /**
   * Bytes of a request image (`{ assetId }`), of an earlier step's output
   * (`StepInputRef`: a Comfy output or a file a code step wrote).
   */
  readBytes(source: ByteSource | ImageRef): Promise<Uint8Array>;
  /**
   * Upload bytes as a Comfy asset and return its id (durable: usable by later
   * comfy steps and storable in soul.json). Content-addressed by the runtime.
   */
  uploadAsset(bytes: Uint8Array, filename: string, contentType: string): Promise<string>;
  /** Aborted when the run is canceled or the step deadline passes. */
  signal: AbortSignal;
};

/** A file a code step produced. The runtime writes it under `.data/runs/<runId>/files/`. */
export type CodeStepFile = {
  /** Unique within the step, e.g. `card.jpg` (`[a-z0-9._-]`, no slashes). */
  name: string;
  contentType: string;
  bytes: Uint8Array;
};

export type CodeHandlerContext<K extends PipelineKind = PipelineKind> = RunIo & {
  /** Snapshot of the run (read-only; the runtime owns every write). */
  run: Readonly<PipelineRun<K>>;
  step: Readonly<CodePipelineStep>;
};

/**
 * What a code step returns. The runtime persists it onto the step:
 * - `status` defaults to `succeeded`; `needs_input` marks missing user copy;
 * - every `files` entry becomes an `OutputRef` in `step.outputs` (url
 *   `/api/pipelines/{kind}/{runId}/files/{name}`, in order);
 * - `data` is stored as `step.data`.
 * Throwing marks the step `failed` with code `handler_error`.
 */
export type CodeHandlerResult = {
  status?: "succeeded" | "needs_input" | "failed" | "skipped";
  files?: CodeStepFile[];
  /** Extra outputs passed through as-is (e.g. a Comfy asset re-exposed). */
  outputs?: OutputRef[];
  data?: JsonValue;
  error?: JobErrorInfo | null;
};

/**
 * An in-process step (photo QA, crop, prompt build, compose, render card,
 * compliance, ...). Must be idempotent: a code step left `running` by a crash
 * is re-run on reconcile (docs/spec/api.md §2.0).
 */
export type CodeHandler<K extends PipelineKind = PipelineKind> = (
  ctx: CodeHandlerContext<K>,
) => Promise<CodeHandlerResult>;

// ---------------------------------------------------------------------------
// actions (per-run follow-ups: retry an item, regenerate a tile, export)
// ---------------------------------------------------------------------------

/**
 * Served by slice A at `{method} /api/pipelines/{kind}/{runId}/{path}`, where
 * `path` is the action's pattern with `:name` segments bound to `params`.
 * Examples (docs/spec/api.md §2.2, §2.3):
 * - photoshoot `{ method: "POST", path: "items/:index/retry" }`
 * - cards `{ method: "POST", path: "tiles/:assetId/regenerate" }`
 * - cards `{ method: "GET", path: "export" }`
 */
export type ActionContext<K extends PipelineKind = PipelineKind> = RunIo & {
  run: Readonly<PipelineRun<K>>;
  params: Record<string, string>;
  /** Parsed JSON body (`null` for GET or an empty body). */
  body: unknown;
  plan: PlanContext;
};

export type ActionResult =
  /**
   * Replace the run's step list (same ids for kept steps). Reset steps must be
   * `pending` with no `submission`/`jobId` (a new seed means a new job). The
   * runtime persists, sets the run `running`, schedules, and answers
   * `202 PipelineRun`. Never mint idempotency keys here.
   */
  | { type: "replan"; steps: PipelineStep[] }
  /** Respond directly (e.g. a zip export); the run is not modified. */
  | { type: "response"; response: Response }
  /** Reject: `400`/`404`/`409 { error }`. */
  | { type: "error"; status: 400 | 404 | 409; error: string };

export type ActionHandler<K extends PipelineKind = PipelineKind> = {
  method: "GET" | "POST";
  /** Path after `{runId}/`, `/`-separated, `:name` binds a param. */
  path: string;
  run(ctx: ActionContext<K>): Promise<ActionResult>;
};

// ---------------------------------------------------------------------------
// The definition each tool exports
// ---------------------------------------------------------------------------

export type PipelineDefinition<K extends PipelineKind> = {
  kind: K;
  /** Pure, synchronous, no I/O. */
  validate(raw: unknown): ValidateResult<PipelineRequestMap[K]>;
  /**
   * Build the full, concrete step list (every step `pending`, with
   * `dependsOn` and `timeoutMs`; seeds and prompts resolved). The request's
   * images are `{ assetId }` by now. May read the identity registry. Runs once per
   * run, before persist; never at resume.
   */
  plan(request: PipelineRequestMap[K], ctx: PlanContext): Promise<PipelineStep[]>;
  /** Code handlers by `CodePipelineStep.workflow` name. Every code step's name must be here. */
  handlers: Record<string, CodeHandler<K>>;
  /**
   * Called when the run becomes terminal (and on demand for partial results).
   * Derives the result from the persisted steps only.
   */
  buildResult(run: Readonly<PipelineRun<K>>): Promise<PipelineResultMap[K]>;
  actions?: Record<string, ActionHandler<K>>;
};

/** Any one of the four definitions (what the registry hands the runtime). */
export type AnyPipelineDefinition = { [K in PipelineKind]: PipelineDefinition<K> }[PipelineKind];

/** The registry shape in lib/pipeline/kinds.ts. */
export type PipelineRegistry = { [K in PipelineKind]: PipelineDefinition<K> };
