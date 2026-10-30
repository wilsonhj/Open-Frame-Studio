/**
 * Server-owned deadlines for single-shot `/api/jobs` submissions.
 *
 * A billing guard must not depend on a browser still polling: a tab can
 * close, reload or lose the network while its job keeps running. So every
 * accepted submit is recorded at `${DATA_DIR:-.data}/jobs/<key>.json` with
 * its deadline, and `reconcileJobs()` (started from instrumentation.ts, and
 * run opportunistically by the job routes) cancels overdue jobs until Comfy
 * reports them terminal. A record is deleted only once its job is terminal
 * (or Comfy no longer knows it).
 *
 * Needs a long-running Node server (`next start`, self-hosting). On a
 * serverless host the interval doesn't run between requests and the file
 * system may be read-only; enforcement then happens only when a job route is
 * hit, so keep STUDIO_ACCESS_CODE on there.
 */
import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Comfy } from "@comfyorg/sdk";

import { createClient, getJob, requestCancel, type CancelOutcome } from "./comfy.ts";

export const JOB_RECORD_SCHEMA = "open-frame-studio/job-deadline@1" as const;

/** Default per-job budget for `/api/jobs` (override with JOB_DEADLINE_MS). */
export function jobBudgetMs(): number {
  const value = Number(process.env.JOB_DEADLINE_MS);
  return Number.isInteger(value) && value > 0 ? value : 15 * 60_000;
}

/** Don't hammer Comfy with cancels for the same job. */
const CANCEL_RETRY_MS = 30_000;
/** Stop tracking a job that is still live this long after its deadline (logged). */
const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
/**
 * How long Comfy must keep answering 404 before a job counts as gone. A
 * single 404 can be transient (just after submit) or a misconfigured proxy,
 * and treating it as final would drop the job's deadline while it may still
 * be running and billing.
 */
export const MISSING_GRACE_MS = 10 * 60_000;

export type JobRecord = {
  schema: typeof JOB_RECORD_SCHEMA;
  jobId: string;
  workflow: string;
  /** Epoch ms. */
  submittedAt: number;
  deadlineAt: number;
  cancel?: { outcome: CancelOutcome; attempts: number; lastAttemptAt: number; error?: string };
  /** Epoch ms of the first 404 in an unbroken run of them (see MISSING_GRACE_MS). */
  missingSince?: number;
};

function jobsDir(): string {
  return join(process.env.DATA_DIR?.trim() || ".data", "jobs");
}

function recordPath(jobId: string): string {
  // Hash the id: it comes from Comfy and must not shape a path.
  return join(jobsDir(), `${createHash("sha256").update(jobId).digest("hex").slice(0, 32)}.json`);
}

async function writeRecord(record: JobRecord): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
  const path = recordPath(record.jobId);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record));
  await rename(tmp, path);
}

/** The job's persisted deadline record, or null if none was saved (or it is unreadable). */
export async function readRecord(jobId: string): Promise<JobRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(jobId), "utf-8")) as JobRecord;
  } catch {
    return null;
  }
}

/**
 * Persist a just-accepted job's deadline. Failure to persist is logged, not
 * thrown: the job is already billed, so the caller must still get its handle.
 */
export async function recordJob(jobId: string, workflow: string, submittedAt: number): Promise<void> {
  try {
    await writeRecord({ schema: JOB_RECORD_SCHEMA, jobId, workflow, submittedAt, deadlineAt: submittedAt + jobBudgetMs() });
  } catch (error) {
    console.error("[job-deadlines] could not persist deadline; enforced only while polled:", error);
  }
}

// In-memory throttle (and last outcome), so polls without a persisted record
// still don't spam cancels and still report what actually happened.
const lastCancel = new Map<string, { at: number; outcome: CancelOutcome }>();

/**
 * Enforce one job's deadline: if it is overdue and still live, request a
 * cancel (throttled) and persist the outcome. Returns null when there is
 * nothing to do (not overdue, or a cancel was attempted recently). Pass the
 * already-read `record` (null: none saved) to skip reading it again.
 */
export async function enforceDeadline(
  client: Comfy,
  jobId: string,
  deadlineAt: number,
  now = Date.now(),
  preloaded?: JobRecord | null,
): Promise<CancelOutcome | null> {
  if (now <= deadlineAt) return null;
  const record = preloaded === undefined ? await readRecord(jobId) : preloaded;
  const memory = lastCancel.get(jobId);
  const persisted = record?.cancel;
  // The newer of the two attempts decides the reported outcome.
  const latest =
    persisted && (!memory || persisted.lastAttemptAt >= memory.at)
      ? { at: persisted.lastAttemptAt, outcome: persisted.outcome }
      : memory;
  if (latest && now - latest.at < CANCEL_RETRY_MS) return latest.outcome;
  // Claimed before the await, so concurrent polls don't send a second cancel;
  // while it is in flight they report it as requested.
  lastCancel.set(jobId, { at: now, outcome: "cancel_requested" });
  const result = await requestCancel(client, jobId);
  lastCancel.set(jobId, { at: now, outcome: result.outcome });
  if (record) {
    record.cancel = {
      outcome: result.outcome,
      attempts: (record.cancel?.attempts ?? 0) + 1,
      lastAttemptAt: now,
      ...(result.error ? { error: result.error } : {}),
    };
    if (result.outcome === "canceled") await forgetJob(jobId);
    else await writeRecord(record).catch(() => undefined);
  }
  return result.outcome;
}

export async function forgetJob(jobId: string): Promise<void> {
  lastCancel.delete(jobId);
  missingSince.delete(jobId);
  await rm(recordPath(jobId), { force: true });
}

// In-memory copy of `missingSince`, for jobs whose record couldn't be persisted.
const missingSince = new Map<string, number>();

/**
 * Comfy answered 404 for this job. Returns true once that has lasted
 * MISSING_GRACE_MS (the job is gone and can be forgotten); until then the
 * caller should keep the deadline and treat the 404 as retryable.
 */
export async function confirmMissing(jobId: string, now = Date.now()): Promise<boolean> {
  const record = await readRecord(jobId);
  const since = Math.min(record?.missingSince ?? now, missingSince.get(jobId) ?? now);
  missingSince.set(jobId, since);
  if (record && record.missingSince === undefined) {
    record.missingSince = since;
    await writeRecord(record).catch(() => undefined);
  }
  return now - since >= MISSING_GRACE_MS;
}

/**
 * Comfy found the job again: end any run of 404s. Free on the common path
 * (no 404 seen in this process); the sweep clears a persisted run after a
 * restart, since it reads the record anyway. Pass the already-read `record`
 * (null: none saved) to skip reading it again.
 */
export async function clearMissing(jobId: string, record?: JobRecord | null): Promise<void> {
  if (!missingSince.delete(jobId) && record?.missingSince === undefined) return;
  const current = record === undefined ? await readRecord(jobId) : record;
  if (current?.missingSince === undefined) return;
  delete current.missingSince;
  await writeRecord(current).catch(() => undefined);
}

/**
 * One sweep over every recorded job: drop terminal ones, cancel overdue live
 * ones. Never throws; returns what it did (for tests and logs).
 */
export async function reconcileJobs(
  client: Comfy,
  now = Date.now(),
): Promise<{ checked: number; forgotten: number; cancelRequests: number }> {
  const summary = { checked: 0, forgotten: 0, cancelRequests: 0 };
  let names: string[];
  try {
    names = (await readdir(jobsDir())).filter((name) => name.endsWith(".json"));
  } catch {
    return summary;
  }
  for (const name of names) {
    let text: string;
    try {
      text = await readFile(join(jobsDir(), name), "utf-8");
    } catch {
      // An I/O error (EMFILE, EIO, EACCES, or removed meanwhile) may be
      // temporary: keep the record and retry next sweep.
      continue;
    }
    let record: JobRecord;
    try {
      record = JSON.parse(text) as JobRecord;
      if (typeof record?.jobId !== "string" || !Number.isFinite(record.deadlineAt)) throw new Error("bad record");
    } catch {
      // Read fine but malformed: it can never be enforced, so don't skip it forever.
      console.error(`[job-deadlines] removing malformed deadline record ${name}`);
      await rm(join(jobsDir(), name), { force: true }).catch(() => undefined);
      summary.forgotten += 1;
      continue;
    }
    summary.checked += 1;
    try {
      const job = await getJob(client, record.jobId);
      await clearMissing(record.jobId, record);
      if (job.terminal) {
        await forgetJob(record.jobId);
        summary.forgotten += 1;
        continue;
      }
    } catch (error) {
      // A job Comfy has stopped knowing about for MISSING_GRACE_MS can't be
      // billing. Anything else, retry next sweep, but not forever: past
      // GIVE_UP_AFTER_MS it is dropped (logged).
      const gone = (error as { httpStatus?: number }).httpStatus === 404 && (await confirmMissing(record.jobId, now));
      if (gone || now - record.deadlineAt > GIVE_UP_AFTER_MS) {
        if (!gone) console.error(`[job-deadlines] job ${record.jobId} unreachable a day past its deadline; giving up.`);
        await forgetJob(record.jobId);
        summary.forgotten += 1;
      }
      continue;
    }
    if (now - record.deadlineAt > GIVE_UP_AFTER_MS) {
      console.error(`[job-deadlines] job ${record.jobId} still live a day past its deadline; giving up.`);
      await forgetJob(record.jobId);
      summary.forgotten += 1;
      continue;
    }
    const outcome = await enforceDeadline(client, record.jobId, record.deadlineAt, now, record);
    if (outcome !== null) summary.cancelRequests += 1;
  }
  return summary;
}

type ReconcilerState = { timer: NodeJS.Timeout | null; running: boolean; lastRunAt: number };

function state(): ReconcilerState {
  const store = globalThis as typeof globalThis & { __jobReconciler?: ReconcilerState };
  store.__jobReconciler ??= { timer: null, running: false, lastRunAt: 0 };
  return store.__jobReconciler;
}

/** Run a sweep unless one is running or ran within `minGapMs`. */
export async function sweepJobs(minGapMs = SWEEP_INTERVAL_MS): Promise<void> {
  const current = state();
  if (current.running || Date.now() - current.lastRunAt < minGapMs) return;
  current.running = true;
  try {
    await reconcileJobs(createClient());
  } catch (error) {
    console.error("[job-deadlines] sweep failed:", error);
  } finally {
    current.lastRunAt = Date.now();
    current.running = false;
  }
}

/** Start the periodic sweep once per process (instrumentation.ts). */
export function startJobReconciler(): void {
  const current = state();
  if (current.timer) return;
  current.timer = setInterval(() => void sweepJobs(0), SWEEP_INTERVAL_MS);
  current.timer.unref();
  void sweepJobs(0);
}
