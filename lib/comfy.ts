/**
 * Server-only wrapper around @comfyorg/sdk 0.5.0.
 *
 * Pattern adapted from Comfy-Org/comfy-reshoot `lib/comfy.ts` (MIT). This
 * module bakes in the known traps of the SDK / API v2:
 *
 *  1. Every wait takes a REQUIRED timeout. A self-hosted proxy job can sit at
 *     `unknown` forever; past the deadline we return a terminal-with-error job
 *     instead of polling indefinitely.
 *  2. `submit()` is NEVER retried here, and never under a fresh key. The
 *     caller mints the Idempotency-Key, persists it, then calls `submitOnce`
 *     with it. A definitive 4xx is `SubmitRejectedError` (a 422
 *     `idempotency_key_reuse` sets `keyReused`); a transport error or 5xx is
 *     `SubmitAmbiguousError` (a job may exist). Only the pipeline runner may
 *     re-send, and only under the SAME key (docs/spec/api.md §2.0); a fresh
 *     key is a second, billed job.
 *  3. No `metadata` is ever passed to `submit()`.
 *  4. We poll `GET /api/v2/jobs/{id}`; we do not rely on SSE events.
 *  5. Outputs are re-hosted through our own route: signed URLs expire, and
 *     the browser never sees a Comfy URL or the API key, and addresses jobs
 *     only through signed handles (lib/access.ts).
 *  6. Workflows must be API format; UI exports are rejected locally.
 *  7. A job past its deadline gets a cancel request, but it is only reported
 *     terminal once Comfy says it is: a failed or pending cancel leaves it
 *     observable (lib/job-deadlines.ts keeps enforcing it server-side).
 *
 * The API key is read from the environment (COMFY_API_KEY) and never logged.
 */
import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  COMFY_CLOUD_BASE_URL,
  Comfy,
  ComfyError,
  MissingCredentials,
  type Job as SdkJob,
  type Workflow,
  type WorkflowGraph,
} from "@comfyorg/sdk";

import type { ApiGraph } from "./bindings/apply.ts";
import type { Job, JobErrorInfo, JobStatus, OutputRef } from "./types.ts";
import { TERMINAL_STATUSES } from "./types.ts";

export type { Workflow } from "@comfyorg/sdk";

const CLIENT_INFO = "open-frame-studio";
const WORKFLOW_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** COMFY_API_KEY missing (Cloud) — map to HTTP 503 in routes. */
export class ComfyNotConfiguredError extends Error {
  constructor(message = "COMFY_API_KEY is not configured.") {
    super(message);
    this.name = "ComfyNotConfiguredError";
  }
}

/**
 * The server definitively rejected a submit (4xx: invalid workflow, idempotency
 * key reuse, insufficient credits, ...). Never retried automatically.
 * `keyReused` (422 `idempotency_key_reuse`) means an earlier POST under the
 * same key already landed: a job may exist, but its id is not known here.
 */
export class SubmitRejectedError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown> | null;
  readonly keyReused: boolean;

  constructor(message: string, code: string, httpStatus: number | null, details: Record<string, unknown> | null) {
    super(message);
    this.name = "SubmitRejectedError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.keyReused = code === "idempotency_key_reuse";
  }
}

/**
 * The submit's outcome is unknown: a transport error, an abort or timeout
 * after the request may have been sent, or a 5xx. A job may or may not exist.
 * Re-send only under the same `idempotencyKey` (docs/spec/api.md §2.0).
 */
export class SubmitAmbiguousError extends Error {
  readonly idempotencyKey: string;
  readonly httpStatus: number | null;

  constructor(message: string, idempotencyKey: string, httpStatus: number | null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SubmitAmbiguousError";
    this.idempotencyKey = idempotencyKey;
    this.httpStatus = httpStatus;
  }
}

/**
 * HTTP status our routes return for a rejected submit. Account problems on
 * the server's key (401/403) are not the user's input, so they become 503;
 * Comfy's own rate limit stays 429; credits stay 402; the rest is 422.
 */
export function rejectedSubmitStatus(httpStatus: number | null): number {
  if (httpStatus === 402 || httpStatus === 429) return httpStatus;
  if (httpStatus === 401 || httpStatus === 403) return 503;
  return 422;
}

/** User-facing message for a rejected submit (never leaks the key). */
export function rejectedSubmitMessage(error: SubmitRejectedError): string {
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return "The studio's Comfy account can't run jobs right now (check the API key and that the plan allows API jobs).";
  }
  if (error.httpStatus === 402) return "The studio's Comfy account is out of credits.";
  if (error.httpStatus === 429) return "Comfy is busy; try again in a minute.";
  return error.message;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type ClientOptions = {
  /** Defaults to process.env.COMFY_API_KEY. Optional for a self-hosted COMFY_BASE_URL. */
  apiKey?: string;
  /** Per-request transport timeout (ms). */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * Build a client. Targets Comfy Cloud unless COMFY_BASE_URL is set (e.g. a
 * self-hosted comfy-api-proxy at http://127.0.0.1:8189).
 */
export function createClient(options: ClientOptions = {}): Comfy {
  const apiKey = (options.apiKey ?? process.env.COMFY_API_KEY)?.trim() || undefined;
  const selfHosted = Boolean(process.env.COMFY_BASE_URL?.trim());
  if (!apiKey && !selfHosted) throw new ComfyNotConfiguredError();
  return new Comfy({
    apiKey,
    clientInfo: CLIENT_INFO,
    timeoutMs: options.timeoutMs,
    fetch: options.fetch,
  });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export function workflowPath(name: string, root = process.cwd()): string {
  if (!WORKFLOW_NAME.test(name)) throw new Error(`Invalid workflow name: ${JSON.stringify(name)}`);
  return join(root, "workflows", `${name}.api.json`);
}

/** Read `workflows/<name>.api.json` as a plain graph; rejects UI-format exports locally. */
export async function loadGraph(name: string, root?: string): Promise<ApiGraph> {
  const graph: unknown = JSON.parse(await readFile(workflowPath(name, root), "utf-8"));
  assertApiFormat(graph);
  return graph as ApiGraph;
}

/** Load `workflows/<name>.api.json` as an SDK Workflow; rejects UI-format exports locally. */
export async function loadWorkflow(client: Comfy, name: string, root?: string): Promise<Workflow> {
  return client.workflows.fromJson(await loadGraph(name, root));
}

export function assertApiFormat(graph: unknown): asserts graph is WorkflowGraph {
  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) {
    throw new Error("Workflow must be a JSON object in API format.");
  }
  const record = graph as Record<string, unknown>;
  if ("nodes" in record && "links" in record) {
    throw new Error("Workflow is a UI export; save it in API format with subgraphs unpacked.");
  }
  for (const [id, node] of Object.entries(record)) {
    if (!node || typeof node !== "object" || typeof (node as { class_type?: unknown }).class_type !== "string") {
      throw new Error(`Workflow node ${id} has no class_type (not API format).`);
    }
  }
}

// ---------------------------------------------------------------------------
// Submit (exactly once)
// ---------------------------------------------------------------------------

export type SubmitOptions = {
  /**
   * REQUIRED. Minted (and, in a pipeline, persisted) by the caller before the
   * call. Re-sending under the same key is safe: the server answers 422
   * `idempotency_key_reuse` instead of creating a second job.
   */
  idempotencyKey: string;
  signal?: AbortSignal;
};

/**
 * Submit a workflow exactly once under the caller's idempotency key. Never
 * retried, never sent with metadata. The SDK may itself wait out a 429
 * `queue_full` (same key, so no double billing); every other failure is
 * classified as SubmitRejectedError (definitive) or SubmitAmbiguousError.
 */
export async function submitOnce(client: Comfy, workflow: Workflow, options: SubmitOptions): Promise<Job> {
  const idempotencyKey = options?.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new TypeError("submitOnce requires an idempotencyKey.");
  }
  let job: SdkJob;
  try {
    job = await client.submit(workflow, { idempotencyKey, signal: options.signal });
  } catch (error) {
    throw toSubmitError(error, idempotencyKey);
  }
  return normalizeJob(job);
}

export function toSubmitError(error: unknown, idempotencyKey: string): Error {
  if (error instanceof MissingCredentials) return new ComfyNotConfiguredError();
  if (error instanceof ComfyError) {
    const status = error.httpStatus ?? null;
    if (status !== null && status >= 400 && status < 500) {
      return new SubmitRejectedError(error.message, error.code ?? "error", status, error.details ?? null);
    }
    // 5xx, or no HTTP status at all (no response to read): outcome unknown.
    return new SubmitAmbiguousError(error.message, idempotencyKey, status, { cause: error });
  }
  // Transport errors (undici "fetch failed"), aborts and timeouts: the POST
  // may have landed.
  const message = error instanceof Error ? error.message : String(error);
  return new SubmitAmbiguousError(message, idempotencyKey, null, { cause: error });
}

// ---------------------------------------------------------------------------
// Status / polling
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, JobStatus> = {
  queued: "queued",
  pending: "queued",
  running: "running",
  in_progress: "running",
  canceling: "running",
  succeeded: "succeeded",
  success: "succeeded",
  completed: "succeeded",
  failed: "failed",
  error: "failed",
  canceled: "canceled",
  cancelled: "canceled",
  expired: "expired",
};

export function normalizeStatus(raw: string | null | undefined): JobStatus {
  if (!raw) return "unknown";
  return STATUS_MAP[raw.toLowerCase()] ?? "unknown";
}

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function outputUrl(jobId: string, outputId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(outputId)}`;
}

export type NormalizeOptions = {
  /** Public id the browser uses for this job (a signed handle); defaults to the Comfy id. */
  publicId?: string;
  /** Only these nodes' outputs are exposed (see WorkflowBinding.outputNodes). */
  outputNodes?: readonly string[];
};

/**
 * True when an output may be shown. An output with no node id can't be
 * attributed, so it is kept rather than silently dropping the result.
 */
export function isExposedOutput(nodeId: string, outputNodes: readonly string[] | undefined): boolean {
  if (!outputNodes || outputNodes.length === 0 || !nodeId) return true;
  return outputNodes.includes(nodeId);
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "avi"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac"]);

/**
 * The output's real media kind. Comfy Cloud labels every saved file
 * `type: "image"`, video and audio included (e.g. an H3 MP4 from node "92"
 * with content type video/mp4), so an "image" whose filename or content type
 * says video/audio is relabelled. Other labels are kept as reported.
 */
export function outputType(type: OutputRef["type"], name: string, contentType: string): OutputRef["type"] {
  if (type !== "image") return type;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const ct = contentType.toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext) || ct.startsWith("video/")) return "video";
  if (AUDIO_EXTENSIONS.has(ext) || ct.startsWith("audio/")) return "audio";
  return type;
}

export function normalizeJob(job: SdkJob, options: NormalizeOptions = {}): Job {
  const status = normalizeStatus(job.status);
  const publicId = options.publicId ?? job.id;
  const outputs: OutputRef[] = job.outputs
    .filter((output) => isExposedOutput(output.nodeId, options.outputNodes))
    .map((output) => ({
      id: output.id,
      jobId: publicId,
      nodeId: output.nodeId,
      name: output.name,
      type: outputType(output.type, output.name, output.contentType),
      contentType: output.contentType,
      sizeBytes: output.sizeBytes,
      url: outputUrl(publicId, output.id),
    }));
  const raw = job.error;
  const error: JobErrorInfo | null = raw
    ? { code: raw.code, message: raw.message, nodeId: raw.node_id ?? null, classType: raw.class_type ?? null }
    : status === "failed" || status === "expired" || status === "canceled"
      ? { code: status, message: `Job ${status}.` }
      : null;
  const progress = job.progress;
  const step =
    progress && progress.step !== null && progress.steps !== null && progress.steps > 0
      ? { current: progress.step, total: progress.steps, nodeClass: progress.currentNodeClass }
      : null;
  return {
    id: publicId,
    status,
    terminal: isTerminalStatus(status),
    progress: progress?.value ?? null,
    step,
    queuePosition: job.queuePosition,
    outputs,
    error,
  };
}

/** Re-key a normalized job onto the public id the browser uses, filtering outputs. */
export function withPublicId(job: Job, publicId: string, outputNodes?: readonly string[]): Job {
  return {
    ...job,
    id: publicId,
    outputs: job.outputs
      .filter((output) => isExposedOutput(output.nodeId, outputNodes))
      .map((output) => ({ ...output, jobId: publicId, url: outputUrl(publicId, output.id) })),
  };
}

export async function getJob(
  client: Comfy,
  id: string,
  signal?: AbortSignal,
  options: NormalizeOptions = {},
): Promise<Job> {
  return normalizeJob(await fetchSdkJob(client, id, signal), options);
}

/**
 * Outcome of asking Comfy to cancel an overdue job:
 * - `canceled`: Comfy reports the job terminal (canceled, or it finished first).
 * - `cancel_requested`: Comfy accepted the request but the job is still live
 *   (e.g. `canceling`).
 * - `cancel_failed`: the request itself failed; the job may still be running.
 */
export type CancelOutcome = "canceled" | "cancel_requested" | "cancel_failed";

/**
 * Ask Comfy to cancel `comfyJobId` and adopt the state it returns. Never
 * claims a cancel it didn't see: only an upstream terminal status counts.
 */
export async function requestCancel(
  client: Comfy,
  comfyJobId: string,
  options: NormalizeOptions = {},
): Promise<{ outcome: CancelOutcome; job: Job | null; error?: string }> {
  try {
    const sdkJob = await client.jobs.get(comfyJobId);
    await sdkJob.cancel();
    const job = normalizeJob(sdkJob, options);
    return { outcome: job.terminal ? "canceled" : "cancel_requested", job };
  } catch (error) {
    return { outcome: "cancel_failed", job: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Annotate a still-live overdue job for the browser. It stays non-terminal,
 * so the client keeps watching it (and can still collect its outputs).
 */
export function overdueJob(job: Job, outcome: Exclude<CancelOutcome, "canceled">, budgetMs: number): Job {
  const minutes = Math.round(budgetMs / 60_000);
  return {
    ...job,
    terminal: false,
    error:
      outcome === "cancel_requested"
        ? { code: outcome, message: `Over its ${minutes}-minute budget; cancel requested, waiting for Comfy to stop it.` }
        : { code: outcome, message: `Over its ${minutes}-minute budget, but the cancel request failed; retrying.` },
  };
}

async function fetchSdkJob(client: Comfy, id: string, signal?: AbortSignal): Promise<SdkJob> {
  const job = await client.jobs.get(id);
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  return job;
}

export type PollOptions = {
  /** REQUIRED. Wall-clock budget for the whole poll loop (ms). */
  timeoutMs: number;
  /** First poll interval (ms); grows 1.5x up to `maxIntervalMs`. */
  intervalMs?: number;
  maxIntervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: Job) => void;
};

/**
 * Poll until terminal or until `timeoutMs` elapses (for server-side
 * pipelines). Never throws on timeout: at the deadline a still-live job
 * (typically `unknown` on a proxy) gets a cancel request and is returned
 * `terminal: true` (stop polling) with error code `poll_timeout`, whose
 * message reports the real upstream outcome of the cancel.
 */
export async function pollJob(client: Comfy, id: string, options: PollOptions): Promise<Job> {
  const timeoutMs = options?.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("pollJob requires a positive finite timeoutMs.");
  }
  const deadline = Date.now() + timeoutMs;
  const maxInterval = options.maxIntervalMs ?? 5_000;
  let interval = options.intervalMs ?? 500;
  for (;;) {
    const job = await getJob(client, id, options.signal);
    options.onUpdate?.(job);
    if (job.terminal) return job;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // The caller (a pipeline step) records `timed_out` and keeps the job id,
      // so the job stays reachable; say exactly what happened to it upstream.
      const cancel = await requestCancel(client, id);
      const upstream = cancel.job ?? job;
      const what =
        cancel.outcome === "canceled"
          ? `ended ${upstream.status}`
          : cancel.outcome === "cancel_requested"
            ? `cancel requested (still ${upstream.status})`
            : `cancel failed (${cancel.error}); it may still be running`;
      return {
        ...upstream,
        terminal: true,
        error: { code: "poll_timeout", message: `Job ${id} was still ${job.status} after ${timeoutMs} ms; ${what}.` },
      };
    }
    await sleep(Math.min(interval, remaining), options.signal);
    interval = Math.min(interval * 1.5, maxInterval);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Outputs (re-hosting)
// ---------------------------------------------------------------------------

export class OutputNotFoundError extends Error {
  constructor(jobId: string, outputId: string) {
    super(`Output ${outputId} not found on job ${jobId}.`);
    this.name = "OutputNotFoundError";
  }
}

/** Origin the client talks to (Comfy Cloud unless COMFY_BASE_URL is set). */
export function apiOrigin(): string {
  return new URL(process.env.COMFY_BASE_URL?.trim() || COMFY_CLOUD_BASE_URL).origin;
}

/**
 * Fetch an output's bytes as a streamable Response, with safe re-hosting
 * headers (see outputResponseHeaders).
 *
 * Cloud: `getDownloadUrl()` returns a short-lived signed URL on a storage
 * host; we fetch it WITHOUT our bearer token and stream it through.
 * Self-hosted proxy: the URL is the asset's own endpoint on the API origin
 * (which may need auth), so we read the bytes through the SDK instead.
 */
export async function fetchOutput(
  client: Comfy,
  jobId: string,
  outputId: string,
  options: { outputNodes?: readonly string[]; signal?: AbortSignal } = {},
): Promise<Response> {
  const job = await client.jobs.get(jobId);
  options.signal?.throwIfAborted();
  const output = job.outputs.find(
    (candidate) => candidate.id === outputId && isExposedOutput(candidate.nodeId, options.outputNodes),
  );
  if (!output) throw new OutputNotFoundError(jobId, outputId);
  const fallbackType = output.contentType || "application/octet-stream";
  const { url } = await output.getDownloadUrl();
  // A self-hosted proxy may return a path-relative asset URL.
  const resolved = new URL(url, apiOrigin());
  if (resolved.origin === apiOrigin()) {
    const bytes = await output.toBytes({ signal: options.signal });
    const headers = outputResponseHeaders(fallbackType, output.name);
    headers.set("Content-Length", String(bytes.byteLength));
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers });
  }
  const response = await fetch(resolved, { signal: options.signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Output download failed with HTTP ${response.status}.`);
  }
  const headers = outputResponseHeaders(response.headers.get("Content-Type") ?? fallbackType, output.name);
  // fetch() decodes gzip/br bodies but keeps the encoded Content-Length, so
  // the length only describes the bytes we stream when nothing was encoded.
  const length = response.headers.get("Content-Length");
  if (length && !response.headers.get("Content-Encoding")) headers.set("Content-Length", length);
  return new Response(response.body, { status: 200, headers });
}

/** Media types served inline from our origin. Anything else is a download. */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
]);

/**
 * Response headers for re-hosted output bytes. Only an allowlist of
 * raster/media types is served inline; HTML, SVG, JS and unknown types are
 * forced to an opaque attachment, and the CSP sandbox keeps any script inert.
 */
export function outputResponseHeaders(contentType: string | null, filename: string): Headers {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const inline = INLINE_TYPES.has(type);
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) || "output";
  return new Headers({
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=300",
  });
}

/** Re-host an output to a local file (e.g. for pipelines that chain steps). */
export async function saveOutput(client: Comfy, jobId: string, outputId: string, destPath: string): Promise<number> {
  const response = await fetchOutput(client, jobId, outputId);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destPath, bytes);
  return bytes.byteLength;
}
