/**
 * Pipeline runtime (slice A; docs/spec/api.md §2.0). validate → upload →
 * plan → persist → drive: ready steps (every dependency succeeded) run in
 * parallel; every transition is persisted through lib/store.ts. The runner
 * is a globalThis singleton so route modules and dev reloads share it.
 */
import type { Comfy } from "@comfyorg/sdk";

import { AccessError } from "../access.ts";
import { applyBindings } from "../bindings/apply.ts";
import { getBinding } from "../bindings/index.ts";
import { prepareGraph } from "../bindings/prepare.ts";
import { ComfyNotConfiguredError, OutputNotFoundError, SubmitAmbiguousError, SubmitRejectedError, apiOrigin, createClient, fetchOutput, getJob, loadGraph, pollJob, requestCancel, submitOnce } from "../comfy.ts";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, verifyImageBytes } from "../inputs.ts";
import { listRunIds, loadRun, readRunFile, removeRunFiles, saveRun, writeRunFile } from "../store.ts";
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

/** Comfy's 0..1 progress of each running step, so run.progress can rise while a long job runs. */
const stepProgress = new WeakMap<PipelineStep, number>();

/** Finished steps plus the Comfy progress of running ones (contracts/pipeline.ts `progress`). */
function runProgress(run: PipelineRun): number {
  if (!run.steps.length) return 1;
  const done = run.steps.reduce((sum, s) => sum + (isTerminal(s) ? 1 : (stepProgress.get(s) ?? 0)), 0);
  return done / run.steps.length;
}

async function persist(run: PipelineRun): Promise<void> {
  run.updatedAt = now();
  run.progress = runProgress(run);
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
  // A credentialed request never follows a redirect: undici would carry the
  // custom X-API-Key header to another origin.
  const res = await fetch(resolved, { ...auth, signal, redirect: auth ? "error" : "follow" });
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

/** Most distinct file parts one create request may upload. */
export const MAX_UPLOAD_PARTS = 8;

/** Names of every `{ upload: name }` reference in a request. */
export function uploadNames(value: unknown): string[] {
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

/**
 * `assetsCreated`: uploads reached Comfy before the run was refused, so the
 * caller must not refund the submit slot (or refusals become free uploads).
 */
export type CreateResult =
  | { ok: true; run: PipelineRun }
  | { ok: false; status: 400 | 404 | 500 | 502 | 503; error: string; field?: string; assetsCreated?: boolean }
  | { ok: false; status: 429; error: string; code: string; retryAfterSeconds: number | null; assetsCreated?: boolean };

/**
 * Bills the Comfy jobs a run is about to submit (lib/pipeline/gate.ts
 * jobCharge): returns their refund, or throws AccessError when over quota.
 */
export type JobCharge = (jobs: number) => () => void;

/** Comfy steps in `next` that will be (re)submitted: new, or reset from a finished step. */
function billedJobs(next: PipelineStep[], current: PipelineStep[] = []): number {
  const byId = new Map(current.map((st) => [st.id, st]));
  return next.filter((st) => {
    if (st.kind !== "comfy" || st.status !== "pending" || st.jobId || st.submission) return false;
    const cur = byId.get(st.id);
    return !cur || cur.status !== "pending";
  }).length;
}

/** A charge refused as an AccessError, else null (rethrow). */
function chargeRefusal(e: unknown): { status: 429; error: string; code: string; retryAfterSeconds: number | null } | null {
  return e instanceof AccessError ? { status: 429, error: e.message, code: e.code, retryAfterSeconds: e.retryAfterSeconds } : null;
}

/** plan() errors: SoulNotFoundError → 404 identityId; `{ status: 400|404, field }` → that; else 500. */
function planError(e: unknown): CreateResult {
  const err = e as { name?: string; message?: string; status?: unknown; field?: unknown } | null;
  const error = err?.message || "Unable to plan the run.";
  if (err?.name === "SoulNotFoundError") return { ok: false, status: 404, error, field: "identityId" };
  if ((err?.status === 400 || err?.status === 404) && typeof err.field === "string") return { ok: false, status: err.status, error, field: err.field };
  return { ok: false, status: 500, error };
}

export async function createRun(kind: string, raw: unknown, uploads: Map<string, UploadPart> = new Map(), charge?: JobCharge): Promise<CreateResult> {
  const def = definitionFor(kind);
  if (!def) return { ok: false, status: 404, error: `Unknown pipeline kind "${kind}".` };
  const checked = def.validate(raw);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, field: checked.field };
  // Check every referenced part before anything is uploaded: present, at most
  // MAX_UPLOAD_PARTS distinct parts, and a real PNG/JPEG/WebP under 20 MB
  // (the /api/jobs rules).
  const names = [...new Set(uploadNames(checked.value))];
  if (names.length > MAX_UPLOAD_PARTS || uploads.size > MAX_UPLOAD_PARTS) {
    return { ok: false, status: 400, error: `At most ${MAX_UPLOAD_PARTS} files per request.`, field: "" };
  }
  for (const name of names) {
    const part = uploads.get(name);
    if (!part) return { ok: false, status: 400, error: `Missing file part "${name}".`, field: name };
    const bad = uploadProblem(name, part);
    if (bad) return { ok: false, status: 400, error: bad, field: name };
    try {
      await verifyImageBytes({ [name]: new File([part.bytes as Uint8Array<ArrayBuffer>], part.filename, { type: part.contentType }) });
    } catch (e) {
      return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e), field: name };
    }
  }
  const runId = crypto.randomUUID();
  const run = { schema: RUN_SCHEMA, id: runId, kind: def.kind, status: "pending", createdAt: now(), updatedAt: now(), timeoutMs: 0, progress: 0, steps: [], request: null, result: null, error: null } as unknown as PipelineRun;
  // Each distinct part is uploaded once, however many times it is referenced.
  const assetIds = new Map<string, Promise<string>>();
  let committed = 0;
  let refundJobs = () => {};
  const refuse = async (result: Extract<CreateResult, { ok: false }>): Promise<CreateResult> => {
    refundJobs(); // nothing was submitted
    // Let every started upload settle first, so the refund decision sees all
    // commits and no late write lands after the cleanup.
    await Promise.allSettled(assetIds.values());
    // Nothing references the files of a run that was never saved.
    await removeRunFiles(runId);
    return committed > 0 ? { ...result, assetsCreated: true } : result;
  };
  try {
    const request = await rewriteUploads(checked.value, (name) => {
      let id = assetIds.get(name);
      if (!id) {
        const part = uploads.get(name)!;
        id = uploadAsset(run, part.bytes, part.filename, part.contentType).then((assetId) => (committed++, assetId));
        assetIds.set(name, id);
      }
      return id;
    });
    run.request = request as PipelineRun["request"];
    try {
      run.steps = await (def.plan as (r: unknown, c: PlanContext) => Promise<PipelineStep[]>)(request, planContext(runId));
    } catch (e) {
      return refuse(planError(e) as Extract<CreateResult, { ok: false }>);
    }
    // One submit slot per planned Comfy job, taken before any is submitted.
    if (charge) {
      try {
        refundJobs = charge(billedJobs(run.steps));
      } catch (e) {
        const refused = chargeRefusal(e);
        if (!refused) throw e;
        return refuse({ ok: false, ...refused });
      }
    }
    run.timeoutMs = run.steps.reduce((sum, s) => sum + s.timeoutMs, 0);
    run.status = "running";
    await persist(run);
  } catch (e) {
    if (e instanceof ComfyNotConfiguredError) return refuse({ ok: false, status: 503, error: e.message });
    return refuse({ ok: false, status: 502, error: e instanceof Error ? e.message : "Unable to start run." });
  }
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

/** A pending step whose dependencies all succeeded (a replan may add one late). */
const hasReady = (run: PipelineRun) =>
  run.steps.some((s) => s.status === "pending" && s.dependsOn.every((d) => run.steps.find((x) => x.id === d)?.status === "succeeded"));

async function drive(def: Def, run: PipelineRun): Promise<void> {
  for (;;) {
    await driveSteps(def, run);
    // A replan that landed while the loop was winding down: run it now rather
    // than marking its steps skipped below.
    if (!run.cancelRequested && hasReady(run)) continue;
    if (await finishRun(def, run)) return;
  }
}

async function driveSteps(def: Def, run: PipelineRun): Promise<void> {
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
}

/** Close a run (status, result, persist); false when a late replan reopened it. */
async function finishRun(def: Def, run: PipelineRun): Promise<boolean> {
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
  if (!run.cancelRequested && hasReady(run)) {
    run.status = "running";
    run.result = null;
    return false;
  }
  await persist(run);
  return true;
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

/** Wait `ms`, or less if `signal` aborts (never rejects). */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Extra time past the step deadline for downloading a job Comfy already finished. */
const DOWNLOAD_GRACE_MS = 30_000;
/** Longest single download attempt, so a hung transfer is retried. */
const DOWNLOAD_ATTEMPT_MS = 60_000;

/**
 * A download error retrying cannot fix: the output does not exist, or the
 * server refused the request (4xx other than 408 timeout and 429 rate limit).
 */
function permanentDownloadError(e: unknown): boolean {
  if (e instanceof OutputNotFoundError) return true;
  const status = Number(/HTTP (\d{3})/.exec(e instanceof Error ? e.message : "")?.[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Download one output of a job Comfy already finished (and billed), retrying
 * transient failures (network, 5xx, 408, 429) with backoff until the step
 * deadline plus a short grace, so a blip never throws away a paid result.
 * A permanent error fails at once; a cancel stops it.
 */
async function downloadOutput(c: Comfy, jobId: string, outputId: string, step: PipelineStep, signal?: AbortSignal): Promise<Uint8Array> {
  const until = Date.parse(step.deadlineAt ?? now()) + DOWNLOAD_GRACE_MS;
  for (let backoff = 500; ; backoff = Math.min(backoff * 2, 10_000)) {
    const left = until - Date.now();
    const attempt = AbortSignal.timeout(Math.max(1, Math.min(DOWNLOAD_ATTEMPT_MS, left)));
    try {
      const response = await fetchOutput(c, jobId, outputId, { signal: signal ? AbortSignal.any([signal, attempt]) : attempt });
      return new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      if (signal?.aborted || permanentDownloadError(e) || until - Date.now() <= 0) throw e;
      await pause(Math.min(backoff, until - Date.now()), signal);
    }
  }
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
    // A step that already sent a submit may have created (and billed) a job:
    // cancelUpstream records that, instead of a bare "canceled".
    if (run.cancelRequested) return step.submission ? cancelUpstream(run, step) : (finish(step, "canceled"), persist(run));
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
        await pause(1000 * step.submission!.attempts, runSignal(run));
        if (run.cancelRequested) return cancelUpstream(run, step);
        return runComfy(run, step);
      }
      throw e;
    }
  }
  // The job exists (and is billed) from here on. A failed poll or download is
  // transient: keep trying until the step deadline, never resubmit, and never
  // end the step "failed" while the job may still be live.
  let job;
  for (let backoff = 500; ; backoff = Math.min(backoff * 2, 10_000)) {
    try {
      job = await pollJob(c, step.jobId!, {
        timeoutMs: remaining(step),
        signal: runSignal(run),
        onUpdate: (j) => {
          if (j.status === "running" || j.status === "queued") step.status = j.status;
          if (j.progress !== null) {
            stepProgress.set(step, Math.max(stepProgress.get(step) ?? 0, j.progress));
            run.progress = runProgress(run);
          }
        },
      });
      break;
    } catch (e) {
      if (run.cancelRequested) return cancelUpstream(run, step);
      if (Date.parse(step.deadlineAt ?? now()) - Date.now() <= 0) {
        // Out of budget: one last look, then ask Comfy to stop the job.
        const last = await getJob(c, step.jobId!).catch(() => null);
        // A job that ended upstream is reported as it ended (api.md §2.0).
        if (last?.terminal) {
          job = last;
          break;
        }
        const cancel = await requestCancel(c, step.jobId!);
        const outcome = cancel.outcome === "cancel_failed" ? `failed (${cancel.error}); the job may still run` : cancel.outcome === "canceled" ? "done" : "requested";
        const message = `Polling Comfy kept failing (${e instanceof Error ? e.message : String(e)}) until the step deadline; cancel ${outcome}.`;
        return (finish(step, "timed_out", { code: "poll_failed", message }), persist(run));
      }
      await pause(Math.min(backoff, remaining(step)), runSignal(run));
    }
  }
  if (job.error?.code === "poll_timeout") return (finish(step, "timed_out", job.error), persist(run));
  if (job.status !== "succeeded") return (finish(step, job.status === "unknown" ? "failed" : job.status, job.error), persist(run));
  const outputs: OutputRef[] = [];
  for (const [i, out] of job.outputs.entries()) {
    let bytes: Uint8Array;
    try {
      bytes = await downloadOutput(c, job.id, out.id, step, runSignal(run));
    } catch (e) {
      if (run.cancelRequested) return (finish(step, "canceled", { code: "canceled", message: `Canceled while downloading the output of finished job ${job.id}.` }), persist(run));
      // The job succeeded upstream; say so, so nobody pays for it twice blindly.
      const message = `Comfy finished job ${job.id}, but downloading its output failed: ${e instanceof Error ? e.message : String(e)}`;
      return (finish(step, "failed", { code: "output_download_failed", message }), persist(run));
    }
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
/**
 * Load a run for a status read. Never waits behind a held run lock (an action
 * may hold it for a while): a non-terminal run not driven by this process is
 * then resumed in the background, and this read returns what is current now.
 */
export async function getRun(id: string): Promise<PipelineRun | null> {
  void resumeRuns();
  const run = await currentRun(id);
  if (!run || RUN_DONE.has(run.status) || rt.active.has(id) || !definitionFor(run.kind)) return run;
  // Resuming is quick when the lock is free (a read and a schedule); behind a
  // held lock it finishes in the background and this read answers now.
  const resumed = resumeOne(id).catch((e) => {
    console.error(`[runs] resume of ${id} failed:`, e instanceof Error ? e.message : e);
    return run;
  });
  return Promise.race([resumed, new Promise<PipelineRun>((r) => setTimeout(() => r(run), GET_RESUME_WAIT_MS))]);
}

/** How long a status read waits for a resume before answering without it. */
const GET_RESUME_WAIT_MS = 250;

/**
 * Schedule a stored, non-terminal run under the run lock, re-reading it there,
 * so a resuming GET and a concurrent cancel or action share one run object.
 */
function resumeOne(id: string): Promise<PipelineRun | null> {
  return withRunLock(id, async () => {
    const run = await currentRun(id);
    const def = run && definitionFor(run.kind);
    if (run && def && !RUN_DONE.has(run.status) && !rt.active.has(id)) void schedule(def, run);
    return rt.live.get(id) ?? run;
  });
}

/** Best effort: reconcile every non-terminal run in the store (once per process). */
export async function resumeRuns(): Promise<void> {
  if (rt.resumed) return;
  rt.resumed = true;
  for (const id of await listRunIds()) {
    if (rt.active.has(id)) continue;
    await resumeOne(id).catch(() => null);
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

export type ActionOutcome =
  | Exclude<ActionResult, { type: "replan" }>
  | { type: "run"; run: PipelineRun; releaseSlot?: boolean }
  | { type: "error"; status: 405; error: string }
  | { type: "error"; status: 429; error: string; code: string; retryAfterSeconds: number | null };

export async function runAction(kind: PipelineKind | string, runId: string, method: "GET" | "POST", segments: string[], body: unknown, charge?: JobCharge): Promise<ActionOutcome> {
  return withRunLock(runId, () => actionLocked(kind, runId, method, segments, body, charge));
}

async function actionLocked(kind: PipelineKind | string, runId: string, method: "GET" | "POST", segments: string[], body: unknown, charge?: JobCharge): Promise<ActionOutcome> {
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
    // Defensive: resumes take the run lock, so the live object should be `run`.
    const live = rt.live.get(run.id);
    if (live && live !== run) {
      live.cancelRequested = true;
      rt.aborts.get(run.id)?.abort(new Error("Run canceled."));
      await persist(live);
    }
    return { type: "run", run: live ?? run };
  }
  // A replan while a cancel winds down would be swept up by the cancel.
  if (run.cancelRequested && rt.active.has(run.id)) {
    return { type: "error", status: 409, error: "The run is being canceled; try again when it has stopped." };
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
    // GET actions are reads (served without the submit gate): they never bill.
    if (method === "GET") return { type: "error", status: 405, error: "A GET action cannot start new work." };
    const target = (await currentRun(runId)) ?? run;
    // One submit slot per Comfy job the replan resets, taken before the merge.
    // Zero jobs: the route already took a slot for this POST. Give it back.
    const jobs = billedJobs(result.steps, target.steps);
    let refundJobs = () => {};
    if (charge) {
      try {
        refundJobs = charge(jobs);
      } catch (e) {
        const refused = chargeRefusal(e);
        if (!refused) throw e;
        return { type: "error", ...refused };
      }
    }
    const conflict = mergeReplan(target, result.steps);
    if (conflict) {
      refundJobs();
      return { type: "error", status: 409, error: conflict };
    }
    target.status = "running";
    target.cancelRequested = false;
    target.result = null;
    target.error = null;
    await persist(target);
    if (!rt.active.has(target.id)) void schedule(def, target);
    else rt.wakers.get(target.id)?.();
    return { type: "run", run: target, releaseSlot: jobs === 0 };
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
