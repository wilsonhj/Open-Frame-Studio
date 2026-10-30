/**
 * Server-only wrapper around @comfyorg/sdk 0.5.0.
 *
 * Pattern adapted from Comfy-Org/comfy-reshoot `lib/comfy.ts` (MIT). This
 * module bakes in the known traps of the SDK / API v2:
 *
 *  1. Every wait takes a REQUIRED timeout. A self-hosted proxy job can sit at
 *     `unknown` forever; past the deadline we return a terminal-with-error job
 *     instead of polling indefinitely.
 *  2. `submit()` is NEVER retried here. Each SDK `submit()` mints a fresh
 *     Idempotency-Key, so a retry is a second (billed) job. A 422
 *     `idempotency_key_reuse` is surfaced as `SubmitRejectedError` as-is.
 *  3. No `metadata` is ever passed to `submit()`.
 *  4. We poll `GET /api/v2/jobs/{id}`; we do not rely on SSE events.
 *  5. Outputs are re-hosted through our own route: signed URLs expire, and
 *     the browser never sees a Comfy URL or the API key, and addresses jobs
 *     only through session-signed handles (lib/access.ts).
 *  7. A job past its deadline is canceled server-side, not just abandoned:
 *     an abandoned job keeps running and billing.
 *  6. Workflows must be API format; UI exports are rejected locally.
 *
 * The API key is read from the environment (COMFY_API_KEY) and never logged.
 */
import "server-only";

import { readFile } from "node:fs/promises";
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

import type { Job, JobErrorInfo, JobStatus, OutputRef } from "./types.ts";
import { TERMINAL_STATUSES } from "./types.ts";

export type { Workflow } from "@comfyorg/sdk";

const CLIENT_INFO = "open-soul-studio";
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
 * The server rejected a submit (4xx: invalid workflow, idempotency key reuse,
 * insufficient credits, ...). Never retried automatically.
 */
export class SubmitRejectedError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown> | null;

  constructor(message: string, code: string, httpStatus: number | null, details: Record<string, unknown> | null) {
    super(message);
    this.name = "SubmitRejectedError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
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

/** Load `workflows/<name>.api.json`; rejects UI-format exports locally. */
export async function loadWorkflow(client: Comfy, name: string, root?: string): Promise<Workflow> {
  const graph = JSON.parse(await readFile(workflowPath(name, root), "utf-8")) as WorkflowGraph;
  assertApiFormat(graph);
  return client.workflows.fromJson(graph);
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

/**
 * Submit a workflow exactly once. Never retried, never sent with metadata.
 * The SDK may itself wait out a 429 `queue_full` (same idempotency key, so
 * no double billing); every other failure is surfaced.
 */
export async function submitOnce(
  client: Comfy,
  workflow: Workflow,
  options: { signal?: AbortSignal } = {},
): Promise<Job> {
  let job: SdkJob;
  try {
    job = await client.submit(workflow, { signal: options.signal });
  } catch (error) {
    throw toSubmitError(error);
  }
  return normalizeJob(job);
}

function toSubmitError(error: unknown): Error {
  if (error instanceof MissingCredentials) return new ComfyNotConfiguredError();
  if (error instanceof ComfyError) {
    const status = error.httpStatus ?? null;
    if (status !== null && status >= 400 && status < 500) {
      return new SubmitRejectedError(error.message, error.code ?? "error", status, error.details ?? null);
    }
    return error;
  }
  return error instanceof Error ? error : new Error(String(error));
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
      type: output.type,
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
  return {
    id: publicId,
    status,
    terminal: isTerminalStatus(status),
    progress: job.progress?.value ?? null,
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
 * Give up on a job that outlived its budget: ask Comfy to cancel it (best
 * effort, so it stops billing) and return it terminal with `poll_timeout`.
 */
export async function expireJob(client: Comfy, job: Job, comfyJobId: string, message: string): Promise<Job> {
  try {
    const sdkJob = await client.jobs.get(comfyJobId);
    await sdkJob.cancel();
  } catch {
    // Cancel is a request, not a guarantee; the timeout still stands.
  }
  return { ...job, terminal: true, error: { code: "poll_timeout", message } };
}

/**
 * One poll with a server-side deadline (what the HTTP route uses). Past
 * `submittedAt + deadlineMs` a non-terminal job is canceled and returned
 * terminal, so the browser can't leave a job running by walking away.
 */
export async function getJobWithDeadline(
  client: Comfy,
  id: string,
  options: NormalizeOptions & { submittedAt: number; deadlineMs: number; now?: number },
): Promise<Job> {
  const job = await getJob(client, id, undefined, options);
  if (job.terminal || (options.now ?? Date.now()) - options.submittedAt <= options.deadlineMs) return job;
  return expireJob(client, job, id, `Job was still ${job.status} after ${Math.round(options.deadlineMs / 60_000)} min; canceled.`);
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
 * pipelines). Never throws on timeout: a job still non-terminal (typically
 * `unknown` on a proxy) at the deadline is canceled and returned as
 * `terminal: true` with error code `poll_timeout`.
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
      return expireJob(client, job, id, `Job ${id} was still ${job.status} after ${timeoutMs} ms; canceled.`);
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
  options: { outputNodes?: readonly string[] } = {},
): Promise<Response> {
  const job = await client.jobs.get(jobId);
  const output = job.outputs.find(
    (candidate) => candidate.id === outputId && isExposedOutput(candidate.nodeId, options.outputNodes),
  );
  if (!output) throw new OutputNotFoundError(jobId, outputId);
  const fallbackType = output.contentType || "application/octet-stream";
  const { url } = await output.getDownloadUrl();
  // A self-hosted proxy may return a path-relative asset URL.
  const resolved = new URL(url, apiOrigin());
  if (resolved.origin === apiOrigin()) {
    const bytes = await output.toBytes();
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: outputResponseHeaders(fallbackType, output.name),
    });
  }
  const response = await fetch(resolved);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Output download failed with HTTP ${response.status}.`);
  }
  return new Response(response.body, {
    status: 200,
    headers: outputResponseHeaders(response.headers.get("Content-Type") ?? fallbackType, output.name),
  });
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
  const { writeFile } = await import("node:fs/promises");
  const response = await fetchOutput(client, jobId, outputId);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destPath, bytes);
  return bytes.byteLength;
}
