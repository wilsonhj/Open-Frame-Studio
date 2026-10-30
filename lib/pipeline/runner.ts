/**
 * Pipeline runtime (slice A; docs/spec/api.md §2.0). validate → upload →
 * plan → persist → drive: ready steps (every dependency succeeded) run in
 * parallel; every transition is persisted through lib/store.ts. The runner
 * is a globalThis singleton so route modules and dev reloads share it.
 */
import type { Comfy } from "@comfyorg/sdk";

import { applyBindings } from "../bindings/apply.ts";
import { getBinding } from "../bindings/index.ts";
import { prepareGraph } from "../bindings/prepare.ts";
import { SubmitAmbiguousError, SubmitRejectedError, apiOrigin, createClient, fetchOutput, loadGraph, pollJob, requestCancel, submitOnce } from "../comfy.ts";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, verifyImageBytes } from "../inputs.ts";
import { listRunIds, loadRun, readRunFile, saveRun, writeRunFile } from "../store.ts";
import type { CodePipelineStep, ComfyPipelineStep, GraphValue, ImageRef, JobErrorInfo, OutputRef, PipelineKind, PipelineRun, PipelineStep, StepInputRef } from "../types.ts";
import { RUN_SCHEMA, SUBMIT_UNCONFIRMED, TERMINAL_STEP_STATUSES } from "../types.ts";
import { getPipeline } from "./kinds.ts";
import type { ActionResult, AnyPipelineDefinition, ByteSource, PlanContext, RunIo } from "./types.ts";

export type UploadPart = { bytes: Uint8Array; filename: string; contentType: string };
type Def = AnyPipelineDefinition;
/**
 * `live` holds the one in-memory run object each active drive loop owns, so
 * cancel and actions change the run being driven (not a detached disk copy);
 * `aborts` stops that run's in-flight waits on cancel.
 */
type Runtime = {
  active: Map<string, Promise<void>>;
  live: Map<string, PipelineRun>;
  aborts: Map<string, AbortController>;
  /** Wakes an active loop that is waiting on in-flight steps (after a replan). */
  wakers: Map<string, () => void>;
  locks: Map<string, Promise<void>>;
  overrides: Map<string, Def>;
  client?: Comfy;
  resumed?: boolean;
};

const g = globalThis as typeof globalThis & { __ossRunner?: Runtime };
const rt: Runtime = (g.__ossRunner ??= { active: new Map(), live: new Map(), aborts: new Map(), wakers: new Map(), locks: new Map(), overrides: new Map() });
rt.live ??= new Map();
rt.aborts ??= new Map();
rt.wakers ??= new Map();
rt.locks ??= new Map();
const BAD = new Set(["failed", "timed_out", "needs_input", "canceled", "expired", "unknown"]);
const UNCONFIRMED_MSG = "A job may have been created and billed; its id was lost. Not resubmitted. Use Regenerate.";

/** Tests: run a fake definition under a kind name. */
export function registerDefinition(def: Def): void {
  rt.overrides.set(def.kind, def);
}
export function definitionFor(kind: string): Def | undefined {
  return rt.overrides.get(kind) ?? getPipeline(kind);
}
function client(): Comfy {
  return (rt.client ??= createClient());
}
const now = () => new Date().toISOString();
const isTerminal = (s: PipelineStep) => TERMINAL_STEP_STATUSES.includes(s.status);
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "x";
/** Directory segment for a step id (store paths allow `[A-Za-z0-9._-]`). */
const seg = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 128) || "x";
const fileUrl = (run: PipelineRun, rel: string) => `/api/pipelines/${run.kind}/${run.id}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
/** Store path of an OutputRef re-hosted under this run (null for a pass-through output). */
const fileRel = (run: PipelineRun, out: OutputRef) => {
  const prefix = `/api/pipelines/${run.kind}/${run.id}/files/`;
  return out.url.startsWith(prefix) ? out.url.slice(prefix.length).split("/").map(decodeURIComponent).join("/") : null;
};
class InputMissingError extends Error {}
const errInfo = (code: string, e: unknown): JobErrorInfo => ({ code, message: e instanceof Error ? e.message : String(e) });
const outType = (ct: string): OutputRef["type"] =>
  ct.startsWith("image/") ? "image" : ct.startsWith("video/") ? "video" : ct.startsWith("audio/") ? "audio" : ct.startsWith("text/") ? "text" : "file";
const extFor = (ct: string) => ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4" })[ct] ?? "";

export function planContext(runId: string): PlanContext {
  return { runId, now: now(), randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] };
}

async function persist(run: PipelineRun): Promise<void> {
  run.updatedAt = now();
  const done = run.steps.filter(isTerminal).length;
  run.progress = run.steps.length ? done / run.steps.length : 1;
  await saveRun(run);
}

// ---------------------------------------------------------------------------
// I/O lent to handlers
// ---------------------------------------------------------------------------

async function uploadAsset(run: PipelineRun, bytes: Uint8Array, filename: string, contentType: string, signal?: AbortSignal): Promise<string> {
  const id = await client().assets.fromBytes(bytes, { filename, contentType }).commit(signal);
  await writeRunFile(run.id, `_assets/${seg(id)}`, bytes);
  return id;
}

/**
 * steps[fromStep].outputs filtered by `outputNode`, then `[index ?? 0]`.
 * `outputNode` is the binding's logical output name for a comfy step, the
 * file name for a code step.
 */
function findRef(run: PipelineRun, ref: StepInputRef): OutputRef | undefined {
  const step = run.steps.find((s) => s.id === ref.fromStep);
  if (!step) return undefined;
  const nodeId = step.kind === "comfy" && ref.outputNode !== undefined ? getBinding(step.workflow)?.outputs[ref.outputNode] : undefined;
  const outs = (step.outputs ?? []).filter(
    (o) => ref.outputNode === undefined || (step.kind === "comfy" ? o.nodeId === nodeId : o.name === ref.outputNode),
  );
  return outs[ref.index ?? 0];
}

function resolveRef(run: PipelineRun, ref: StepInputRef): OutputRef {
  const out = findRef(run, ref);
  if (!out) throw new InputMissingError(`No output ${ref.outputNode ?? ""}[${ref.index ?? 0}] from step "${ref.fromStep}".`);
  return out;
}

async function readBytes(run: PipelineRun, source: ByteSource | ImageRef, signal?: AbortSignal): Promise<Uint8Array> {
  if ("upload" in source) throw new Error("Unresolved upload ref.");
  if ("fromStep" in source) {
    const out = resolveRef(run, source);
    const rel = fileRel(run, out);
    const local = rel ? await readRunFile(run.id, rel) : null;
    if (local) return local;
    return readBytes(run, { assetId: out.id }, signal);
  }
  const local = await readRunFile(run.id, `_assets/${seg(source.assetId)}`);
  if (local) return local;
  for (const s of run.steps) {
    const out = s.outputs?.find((o) => o.id === source.assetId);
    if (out) return readBytes(run, { fromStep: s.id, index: s.outputs!.indexOf(out) }, signal);
  }
  const asset = await client().assets.get(source.assetId);
  const { url } = await asset.getDownloadUrl(signal);
  // A self-hosted proxy may return a path-relative URL. The Comfy key goes to
  // the configured API origin only, never to a signed object-storage URL.
  const resolved = new URL(url, apiOrigin());
  const key = process.env.COMFY_API_KEY?.trim();
  const auth = key && resolved.origin === apiOrigin() ? { headers: { "X-API-Key": key, Authorization: `Bearer ${key}` } } : undefined;
  const res = await fetch(resolved, { ...auth, signal });
  if (!res.ok) throw new Error(`Asset download failed with HTTP ${res.status}.`);
  return new Uint8Array(await res.arrayBuffer());
}

function runIo(run: PipelineRun, signal: AbortSignal): RunIo {
  return {
    readBytes: (source) => readBytes(run, source, signal),
    uploadAsset: (bytes, filename, ct) => uploadAsset(run, bytes, filename, ct, signal),
    signal,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Names of every `{ upload: name }` reference in a request. */
function uploadNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(uploadNames);
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  if (typeof rec.upload === "string" && Object.keys(rec).length === 1) return [rec.upload];
  return Object.values(rec).flatMap(uploadNames);
}

function uploadProblem(name: string, part: UploadPart): string | null {
  if (part.bytes.byteLength === 0) return `Upload an image for "${name}".`;
  if (!(IMAGE_TYPES as readonly string[]).includes(part.contentType)) return `"${name}" must be PNG, JPEG or WebP.`;
  if (part.bytes.byteLength > MAX_IMAGE_BYTES) return `"${name}" must be under 20 MB.`;
  return null;
}

async function rewriteUploads(value: unknown, upload: (name: string) => Promise<string>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => rewriteUploads(v, upload)));
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.upload === "string" && Object.keys(rec).length === 1) return { assetId: await upload(rec.upload) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = await rewriteUploads(v, upload);
    return out;
  }
  return value;
}

export type CreateResult = { ok: true; run: PipelineRun } | { ok: false; status: 400 | 404 | 500; error: string; field?: string };

/** plan() errors: SoulNotFoundError → 404 identityId; `{ status: 400|404, field }` → that; else 500. */
function planError(e: unknown): CreateResult {
  const err = e as { name?: string; message?: string; status?: unknown; field?: unknown } | null;
  const error = err?.message || "Unable to plan the run.";
  if (err?.name === "SoulNotFoundError") return { ok: false, status: 404, error, field: "identityId" };
  if ((err?.status === 400 || err?.status === 404) && typeof err.field === "string") return { ok: false, status: err.status, error, field: err.field };
  return { ok: false, status: 500, error };
}

export async function createRun(kind: string, raw: unknown, uploads: Map<string, UploadPart> = new Map()): Promise<CreateResult> {
  const def = definitionFor(kind);
  if (!def) return { ok: false, status: 404, error: `Unknown pipeline kind "${kind}".` };
  const checked = def.validate(raw);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, field: checked.field };
  const runId = crypto.randomUUID();
  const run = { schema: RUN_SCHEMA, id: runId, kind: def.kind, status: "pending", createdAt: now(), updatedAt: now(), timeoutMs: 0, progress: 0, steps: [], request: null, result: null, error: null } as unknown as PipelineRun;
  // Every referenced upload must be a real PNG/JPEG/WebP under 20 MB (the
  // /api/jobs rules) before any asset is created or job submitted.
  for (const name of uploadNames(checked.value)) {
    const part = uploads.get(name);
    if (!part) continue;
    const bad = uploadProblem(name, part);
    if (bad) return { ok: false, status: 400, error: bad, field: name };
    try {
      await verifyImageBytes({ [name]: new File([part.bytes as Uint8Array<ArrayBuffer>], part.filename, { type: part.contentType }) });
    } catch (e) {
      return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e), field: name };
    }
  }
  let missing: string | null = null;
  const request = await rewriteUploads(checked.value, async (name) => {
    const part = uploads.get(name);
    if (!part) {
      missing = name;
      return "";
    }
    return uploadAsset(run, part.bytes, part.filename, part.contentType);
  });
  if (missing) return { ok: false, status: 400, error: `Missing file part "${missing}".`, field: missing };
  run.request = request as PipelineRun["request"];
  try {
    run.steps = await (def.plan as (r: unknown, c: PlanContext) => Promise<PipelineStep[]>)(request, planContext(runId));
  } catch (e) {
    return planError(e);
  }
  run.timeoutMs = run.steps.reduce((sum, s) => sum + s.timeoutMs, 0);
  run.status = "running";
  await persist(run);
  schedule(def, run);
  return { ok: true, run };
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

function schedule(def: Def, run: PipelineRun): Promise<void> {
  const existing = rt.active.get(run.id);
  if (existing) return existing;
  const abort = new AbortController();
  const p = drive(def, run)
    .catch(async (e) => {
      run.status = "failed";
      run.error = errInfo("runner_error", e);
      await persist(run).catch(() => undefined);
    })
    .finally(() => {
      rt.active.delete(run.id);
      rt.live.delete(run.id);
      rt.aborts.delete(run.id);
      rt.wakers.delete(run.id);
      // An action may have replanned steps after the loop's last pass.
      if (!run.cancelRequested && run.steps.some((st) => st.status === "pending")) void schedule(def, run);
    });
  rt.active.set(run.id, p);
  rt.live.set(run.id, run);
  rt.aborts.set(run.id, abort);
  return p;
}

const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));

/** The run's cancel signal (aborted when a cancel reaches the live run). */
function runSignal(run: PipelineRun): AbortSignal | undefined {
  return rt.aborts.get(run.id)?.signal;
}

/**
 * Serializes action transitions per run (read → handler → merge → persist →
 * schedule), so concurrent actions on an idle run share one canonical object.
 * The drive loop never takes it, so actions don't wait for running steps.
 */
async function withRunLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = rt.locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = prev.then(() => new Promise<void>((r) => (release = r)));
  rt.locks.set(id, mine);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (rt.locks.get(id) === mine) rt.locks.delete(id);
  }
}

/** The in-memory run an active loop is driving, else the stored copy. */
async function currentRun(id: string): Promise<PipelineRun | null> {
  return rt.live.get(id) ?? (await loadRun(id));
}

/** Wait for a run's in-process loop (tests / shutdown). */
export function whenIdle(runId: string): Promise<void> {
  return rt.active.get(runId) ?? Promise.resolve();
}

async function drive(def: Def, run: PipelineRun): Promise<void> {
  const inflight = new Map<string, Promise<void>>();
  for (;;) {
    if (run.cancelRequested) break;
    let changed = false;
    for (const s of run.steps) {
      if (s.status !== "pending") continue;
      const deps = s.dependsOn.map((d) => run.steps.find((x) => x.id === d));
      if (deps.some((d) => !d || (isTerminal(d) && d.status !== "succeeded"))) {
        s.status = "skipped";
        s.finishedAt = now();
        changed = true;
      }
    }
    if (changed) await persist(run);
    const launch = run.steps.filter(
      (s) => !isTerminal(s) && !inflight.has(s.id) && (s.status !== "pending" || s.dependsOn.every((d) => run.steps.find((x) => x.id === d)?.status === "succeeded")),
    );
    for (const s of launch) {
      const p = runStep(def, run, s)
        .catch(async (e) => {
          s.status = "failed";
          s.error = errInfo("runner_error", e);
          s.finishedAt = now();
          await persist(run);
        })
        .finally(() => inflight.delete(s.id));
      inflight.set(s.id, p);
    }
    if (inflight.size === 0) break;
    const woken = new Promise<void>((resolve) => rt.wakers.set(run.id, resolve));
    await Promise.race([...inflight.values(), woken, ...(runSignal(run) ? [aborted(runSignal(run)!)] : [])]);
    rt.wakers.delete(run.id);
  }
  await Promise.allSettled(inflight.values());
  for (const s of run.steps) {
    // A cancel persisted before a restart: steps that reached Comfy are asked
    // to stop upstream, not just marked canceled locally.
    if (!isTerminal(s) && run.cancelRequested && s.kind === "comfy" && (s.jobId || s.submission)) {
      await cancelUpstream(run, s).catch((e) => finish(s, "canceled", errInfo("cancel_failed", e)));
      continue;
    }
    if (!isTerminal(s)) {
      s.status = run.cancelRequested ? "canceled" : "skipped";
      s.finishedAt = now();
    }
  }
  const bad = run.steps.some((s) => BAD.has(s.status));
  // A deliverable is a succeeded leaf step (one no other step depends on).
  const good = run.steps.some((s) => s.status === "succeeded" && !run.steps.some((x) => x.dependsOn.includes(s.id)));
  run.status = run.cancelRequested ? "canceled" : !bad ? "succeeded" : good ? "partial" : "failed";
  try {
    run.result = await (def.buildResult as (r: PipelineRun) => Promise<PipelineRun["result"]>)(run);
  } catch (e) {
    run.result = null;
    run.error = errInfo("build_result_failed", e);
    if (run.status === "succeeded") run.status = "partial";
  }
  await persist(run);
}

async function startStep(run: PipelineRun, step: PipelineStep): Promise<void> {
  if (step.startedAt && step.deadlineAt) return;
  step.startedAt = now();
  step.deadlineAt = new Date(Date.now() + step.timeoutMs).toISOString();
  step.status = "running";
}

function remaining(step: PipelineStep): number {
  return Math.max(1, Date.parse(step.deadlineAt ?? now()) - Date.now());
}

function finish(step: PipelineStep, status: PipelineStep["status"], error: JobErrorInfo | null = null): void {
  step.status = status;
  step.error = error;
  step.finishedAt = now();
}

async function runStep(def: Def, run: PipelineRun, step: PipelineStep): Promise<void> {
  if (step.kind === "code") return runCode(def, run, step);
  return runComfy(run, step);
}

async function runCode(def: Def, run: PipelineRun, step: CodePipelineStep): Promise<void> {
  await startStep(run, step);
  await persist(run);
  const handler = def.handlers[step.workflow] as ((ctx: unknown) => ReturnType<Def["handlers"][string]>) | undefined;
  if (!handler) return (finish(step, "failed", { code: "handler_missing", message: `No handler "${step.workflow}".` }), persist(run));
  const cancel = runSignal(run);
  const signal = cancel ? AbortSignal.any([AbortSignal.timeout(remaining(step)), cancel]) : AbortSignal.timeout(remaining(step));
  try {
    // The deadline (or a cancel) ends the step even if the handler ignores the
    // signal; a result that arrives later is dropped, never committed.
    const result = await Promise.race([
      handler({ ...runIo(run, signal), run, step }),
      new Promise<never>((_, reject) => {
        const stop = () => reject(signal.reason ?? new Error("Step deadline passed."));
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      }),
    ]);
    const outputs: OutputRef[] = [];
    for (const f of result.files ?? []) {
      const rel = `${seg(step.id)}/${safe(f.name)}`;
      await writeRunFile(run.id, rel, f.bytes);
      outputs.push({ id: `${step.id}/${f.name}`, jobId: "", nodeId: "", name: f.name, type: outType(f.contentType), contentType: f.contentType, sizeBytes: f.bytes.byteLength, url: fileUrl(run, rel) });
    }
    step.outputs = [...outputs, ...(result.outputs ?? [])];
    if (result.data !== undefined) step.data = result.data;
    finish(step, result.status ?? "succeeded", result.error ?? null);
  } catch (e) {
    finish(step, run.cancelRequested ? "canceled" : signal.aborted ? "timed_out" : "failed", errInfo("handler_error", e));
  }
  await persist(run);
}

async function graphValues(run: PipelineRun, step: ComfyPipelineStep): Promise<Record<string, GraphValue>> {
  const binding = getBinding(step.workflow);
  const values: Record<string, GraphValue> = {};
  for (const [name, raw] of Object.entries(step.inputs)) {
    let value: GraphValue;
    if (typeof raw === "object") {
      const out = findRef(run, raw);
      if (!out) {
        // Unresolved: omit an optional input, fail the step on a required one.
        if (binding?.inputs[name]?.required) throw new InputMissingError(`Required input "${name}" has no output from step "${raw.fromStep}".`);
        continue;
      }
      // A code-step file is uploaded on first use (content-addressed, so re-use dedupes).
      const id = out.jobId ? out.id : await uploadAsset(run, await readBytes(run, raw), out.name || "input.png", out.contentType);
      value = (await (await client().assets.get(id)).asReference()) as GraphValue;
    } else if (typeof raw === "string" && binding?.inputs[name]?.kind === "image") {
      value = (await (await client().assets.get(raw)).asReference()) as GraphValue;
    } else value = raw;
    values[name] = value;
  }
  return values;
}

/** Ask Comfy to stop a step's job and record the outcome Comfy actually reports. */
async function cancelUpstream(run: PipelineRun, step: ComfyPipelineStep): Promise<void> {
  if (!step.jobId) {
    const unknown = step.submission && step.submission.state !== "rejected";
    finish(step, "canceled", unknown ? { code: SUBMIT_UNCONFIRMED, message: "Canceled; a job may have been created and billed, and its id is unknown." } : null);
    return persist(run);
  }
  const cancel = await requestCancel(client(), step.jobId);
  const message =
    cancel.outcome === "canceled"
      ? `Canceled; Comfy reports the job ${cancel.job?.status ?? "ended"}.`
      : cancel.outcome === "cancel_requested"
        ? `Cancel requested; Comfy still reports the job ${cancel.job?.status ?? "live"}, so it may finish and be billed.`
        : `Cancel request failed (${cancel.error}); the job may still run and be billed.`;
  finish(step, "canceled", { code: cancel.outcome, message });
  return persist(run);
}

async function runComfy(run: PipelineRun, step: ComfyPipelineStep): Promise<void> {
  const c = client();
  if (!step.jobId) {
    const binding = getBinding(step.workflow);
    if (!binding) return (finish(step, "failed", { code: "unknown_workflow", message: step.workflow }), persist(run));
    if (step.submission && (step.submission.attempts >= 3 || Date.now() - Date.parse(step.submission.mintedAt) > 23 * 3600_000)) {
      step.submission.state = "unconfirmed";
      return (finish(step, "failed", { code: SUBMIT_UNCONFIRMED, message: UNCONFIRMED_MSG }), persist(run));
    }
    let values: Record<string, GraphValue>;
    try {
      values = await graphValues(run, step);
    } catch (e) {
      if (!(e instanceof InputMissingError)) throw e;
      return (finish(step, "failed", errInfo("input_missing", e)), persist(run));
    }
    const graph = applyBindings(prepareGraph(step.workflow, await loadGraph(step.workflow), values), binding, values);
    if (run.cancelRequested) return (finish(step, "canceled"), persist(run));
    await startStep(run, step);
    step.submission = step.submission
      ? { ...step.submission, attempts: step.submission.attempts + 1 }
      : { idempotencyKey: crypto.randomUUID(), state: "sending", mintedAt: now(), attempts: 1 };
    await persist(run);
    try {
      const job = await submitOnce(c, c.workflows.fromJson(graph), { idempotencyKey: step.submission.idempotencyKey });
      step.jobId = job.id;
      step.submission.state = "accepted";
      step.status = job.status === "unknown" ? "queued" : job.status;
      await persist(run);
    } catch (e) {
      if (e instanceof SubmitRejectedError) {
        step.submission.state = e.keyReused ? "unconfirmed" : "rejected";
        step.submission.lastError = errInfo(e.code, e);
        finish(step, "failed", e.keyReused ? { code: SUBMIT_UNCONFIRMED, message: UNCONFIRMED_MSG } : { code: e.code, message: e.message });
        return persist(run);
      }
      if (e instanceof SubmitAmbiguousError) {
        step.submission.lastError = errInfo("submit_ambiguous", e);
        await persist(run);
        await new Promise((r) => setTimeout(r, 1000 * step.submission!.attempts));
        return runComfy(run, step);
      }
      throw e;
    }
  }
  let job;
  try {
    job = await pollJob(c, step.jobId!, {
      timeoutMs: remaining(step),
      signal: runSignal(run),
      onUpdate: (j) => {
        if (j.status === "running" || j.status === "queued") step.status = j.status;
      },
    });
  } catch (e) {
    if (!run.cancelRequested) throw e;
    return cancelUpstream(run, step);
  }
  if (job.error?.code === "poll_timeout") return (finish(step, "timed_out", job.error), persist(run));
  if (job.status !== "succeeded") return (finish(step, job.status === "unknown" ? "failed" : job.status, job.error), persist(run));
  const outputs: OutputRef[] = [];
  for (const [i, out] of job.outputs.entries()) {
    const bytes = new Uint8Array(await (await fetchOutput(c, job.id, out.id)).arrayBuffer());
    const rel = `${seg(step.id)}/${i}${extFor(out.contentType)}`;
    await writeRunFile(run.id, rel, bytes);
    outputs.push({ ...out, sizeBytes: bytes.byteLength, url: fileUrl(run, rel) });
  }
  step.outputs = outputs;
  finish(step, "succeeded");
  await persist(run);
}

// ---------------------------------------------------------------------------
// Read / resume / actions
// ---------------------------------------------------------------------------

const RUN_DONE = new Set(["succeeded", "partial", "failed", "canceled"]);

/** Load a run; a non-terminal run not driven by this process is resumed. */
export async function getRun(id: string): Promise<PipelineRun | null> {
  void resumeRuns();
  const run = await currentRun(id);
  if (run && !RUN_DONE.has(run.status) && !rt.active.has(id)) {
    const def = definitionFor(run.kind);
    if (def) void schedule(def, run);
  }
  return run;
}

/** Best effort: reconcile every non-terminal run in the store (once per process). */
export async function resumeRuns(): Promise<void> {
  if (rt.resumed) return;
  rt.resumed = true;
  for (const id of await listRunIds()) {
    if (rt.active.has(id)) continue;
    const run = await loadRun(id).catch(() => null);
    const def = run && definitionFor(run.kind);
    if (run && def && !RUN_DONE.has(run.status)) void schedule(def, run);
  }
}

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [i, p] of parts.entries()) {
    if (p.startsWith(":")) params[p.slice(1)] = segments[i];
    else if (p !== segments[i]) return null;
  }
  return params;
}

export type ActionOutcome = Exclude<ActionResult, { type: "replan" }> | { type: "run"; run: PipelineRun };

export async function runAction(kind: PipelineKind | string, runId: string, method: "GET" | "POST", segments: string[], body: unknown): Promise<ActionOutcome> {
  return withRunLock(runId, () => actionLocked(kind, runId, method, segments, body));
}

async function actionLocked(kind: PipelineKind | string, runId: string, method: "GET" | "POST", segments: string[], body: unknown): Promise<ActionOutcome> {
  const def = definitionFor(kind);
  const run = await currentRun(runId);
  if (!def || !run || run.kind !== kind) return { type: "error", status: 404, error: "Run not found." };
  if (method === "POST" && segments.join("/") === "cancel") {
    if (RUN_DONE.has(run.status) && !rt.active.has(run.id)) return { type: "run", run };
    // `run` is the live object when a loop drives it: the loop stops launching
    // steps, and aborting wakes its in-flight waits, which cancel upstream.
    run.cancelRequested = true;
    rt.aborts.get(run.id)?.abort(new Error("Run canceled."));
    await persist(run);
    if (!rt.active.has(run.id)) void schedule(def, run);
    return { type: "run", run };
  }
  for (const action of Object.values(def.actions ?? {})) {
    const params = action.method === method ? matchPath(action.path, segments) : null;
    if (!params) continue;
    // Validate against current state now (a running item gets its 409 at once);
    // the handler sees a copy, and only its replan is merged into the live run.
    const snapshot = structuredClone(run);
    const ctx = { ...runIo(snapshot, AbortSignal.timeout(300_000)), run: snapshot, params, body, plan: planContext(run.id) };
    const result = await (action.run as (c: unknown) => Promise<ActionResult>)(ctx);
    if (result.type !== "replan") return result;
    const target = (await currentRun(runId)) ?? run;
    const conflict = mergeReplan(target, result.steps);
    if (conflict) return { type: "error", status: 409, error: conflict };
    target.status = "running";
    target.cancelRequested = false;
    target.result = null;
    target.error = null;
    await persist(target);
    if (!rt.active.has(target.id)) void schedule(def, target);
    else rt.wakers.get(target.id)?.();
    return { type: "run", run: target };
  }
  return { type: "error", status: 404, error: "Unknown action." };
}

/**
 * Merge a replanned step list into `run` by step id, synchronously (so no
 * other write interleaves). Only steps reset to `pending` with no submission
 * or job id are taken from the replan; every other step keeps its current
 * state. Resetting a step that has started and is not terminal is refused.
 */
function mergeReplan(run: PipelineRun, steps: PipelineStep[]): string | null {
  const current = new Map(run.steps.map((st) => [st.id, st]));
  const merged: PipelineStep[] = [];
  for (const next of steps) {
    const cur = current.get(next.id);
    const reset = next.status === "pending" && !next.jobId && !(next.kind === "comfy" && next.submission);
    if (!cur) merged.push(next);
    else if (!reset || cur.status === "pending") merged.push(cur);
    else if (!isTerminal(cur)) return `Step "${next.id}" is still ${cur.status}.`;
    else merged.push(next);
  }
  run.steps = merged;
  return null;
}
