/**
 * Contracts: multi-step pipeline runs (part of the frozen Wave 1 contract;
 * barrel: lib/types.ts). No runtime dependencies.
 */
import type { WorkflowName } from "./bindings.ts";
import type { JobErrorInfo, JobStatus, OutputRef } from "./job.ts";
import type { CardsRequest, CardsResult } from "./listing.ts";
import type { MotionRequest, MotionResult } from "./motion.ts";
import type { PhotoshootRequest, PhotoshootResult } from "./photoshoot.ts";
import type { IdentityRequest, IdentityResult } from "./identity.ts";

// ---------------------------------------------------------------------------
// Pipelines (flat step lists with dependsOn: identity, photoshoot, cards, motion)
// ---------------------------------------------------------------------------

export type PipelineKind = "identity" | "photoshoot" | "listing" | "motion";

/** A reference to an earlier step's output, used to wire steps together. */
export type StepInputRef = { fromStep: string; outputNode?: string; index?: number };

/** A JSON-serialisable value (persisted inside the run document). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
  /**
   * Additive (contracts-v1): small JSON result of a `code` step (QA scores,
   * crops, assembled prompt, layout, ...), persisted with the step so later
   * steps and `buildResult` read it without re-running the handler.
   */
  data?: JsonValue;
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
  identity: IdentityRequest;
  photoshoot: PhotoshootRequest;
  listing: CardsRequest;
  motion: MotionRequest;
};

export type PipelineResultMap = {
  identity: IdentityResult;
  photoshoot: PhotoshootResult;
  listing: CardsResult;
  motion: MotionResult;
};

export const RUN_SCHEMA = "open-frame-studio/run@1" as const;

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
