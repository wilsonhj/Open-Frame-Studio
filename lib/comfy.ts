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
 *     the browser never sees a Comfy URL or the API key.
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

export function normalizeJob(job: SdkJob): Job {
  const status = normalizeStatus(job.status);
  const outputs: OutputRef[] = job.outputs.map((output) => ({
    id: output.id,
    jobId: job.id,
    nodeId: output.nodeId,
    name: output.name,
    type: output.type,
    contentType: output.contentType,
    sizeBytes: output.sizeBytes,
    url: outputUrl(job.id, output.id),
  }));
  const raw = job.error;
  const error: JobErrorInfo | null = raw
    ? { code: raw.code, message: raw.message, nodeId: raw.node_id ?? null, classType: raw.class_type ?? null }
    : status === "failed" || status === "expired" || status === "canceled"
      ? { code: status, message: `Job ${status}.` }
      : null;
  return {
    id: job.id,
    status,
    terminal: isTerminalStatus(status),
    progress: job.progress?.value ?? null,
    queuePosition: job.queuePosition,
    outputs,
    error,
  };
}

export async function getJob(client: Comfy, id: string, signal?: AbortSignal): Promise<Job> {
  return normalizeJob(await fetchSdkJob(client, id, signal));
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
 * Poll until terminal or until `timeoutMs` elapses. Never throws on timeout:
 * a job still non-terminal (typically `unknown` on a proxy) at the deadline
 * is returned as `terminal: true` with error code `poll_timeout`.
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
      return {
        ...job,
        terminal: true,
        error: {
          code: "poll_timeout",
          message: `Job ${id} was still ${job.status} after ${timeoutMs} ms; giving up.`,
        },
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
 * Fetch an output's bytes as a streamable Response.
 *
 * Cloud: `getDownloadUrl()` returns a short-lived signed URL on a storage
 * host; we fetch it WITHOUT our bearer token and stream it through.
 * Self-hosted proxy: the URL is the asset's own endpoint on the API origin
 * (which may need auth), so we read the bytes through the SDK instead.
 */
export async function fetchOutput(client: Comfy, jobId: string, outputId: string): Promise<Response> {
  const job = await client.jobs.get(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new OutputNotFoundError(jobId, outputId);
  const fallbackType = output.contentType || "application/octet-stream";
  const { url } = await output.getDownloadUrl();
  if (new URL(url).origin === apiOrigin()) {
    const bytes = await output.toBytes();
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": fallbackType } });
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Output download failed with HTTP ${response.status}.`);
  }
  return new Response(response.body, {
    status: 200,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? fallbackType },
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
