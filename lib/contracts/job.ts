/**
 * Contracts: jobs, outputs and image references (part of the frozen Wave 1
 * contract; barrel: lib/types.ts). No runtime dependencies.
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
// Image references inside JSON pipeline requests
// ---------------------------------------------------------------------------

/**
 * `upload`: the name of a file part in the same multipart request.
 * `assetId`: an existing Comfy asset (e.g. `OutputRef.id` of an earlier job).
 */
export type ImageRef = { upload: string } | { assetId: string };
