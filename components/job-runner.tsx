"use client";

/**
 * Generic submit-and-poll runner. Polling pattern adapted from
 * Comfy-Org/comfy-reshoot `components/app-runner.tsx` (MIT).
 */
import { useEffect, useState } from "react";

import { getBinding, seedInputs } from "../lib/bindings";
import {
  TOUCH_EVERY_MS,
  forgetJob,
  recoverRun,
  rememberJob,
  tabId,
  touchJob,
  type RecoveredRun,
} from "../lib/job-recovery";
import { describeJob } from "../lib/job-status";
import type { Job, SubmittedJob } from "../lib/types";

const POLL_MS = 2_000;
const RETRY_MS = 5_000;
/**
 * Pause after this many failed polls in a row and offer "Resume checking".
 * The job deadline is enforced server-side (lib/job-deadlines.ts), so
 * pausing here never leaves a job unguarded.
 */
const MAX_POLL_FAILURES = 30;
/**
 * Unfinished jobs survive reloads (lib/job-recovery.ts): one entry per job,
 * so one tab's finished job never erases another tab's unfinished one.
 * Storage may be blocked; the job still runs and is still deadline-enforced
 * server-side, so failures here are ignored.
 */
function remember(workflow: string, job: Job, seeds?: Record<string, number>): void {
  try {
    rememberJob(window.localStorage, tabId(window.sessionStorage), workflow, job, Date.now(), seeds);
  } catch {}
}

/** Mark the run as still watched, even when a poll failed or polling is paused. */
function touch(jobId: string): void {
  try {
    touchJob(window.localStorage, tabId(window.sessionStorage), jobId);
  } catch {}
}

function forget(job: Job | null): void {
  try {
    if (job) forgetJob(window.localStorage, job.id);
  } catch {}
}

function recover(workflow: string): RecoveredRun | null {
  try {
    return recoverRun(window.localStorage, tabId(window.sessionStorage), workflow);
  } catch {
    return null;
  }
}

/** A 4xx other than timeout/rate-limit won't change on retry (e.g. 404: the handle is no longer valid). */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function JobRunner({ workflow = "image_resize_smoke" }: { workflow?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(0.5);
  const [job, setJob] = useState<Job | null>(null);
  const [pollRetry, setPollRetry] = useState(0);
  const [accessCode, setAccessCode] = useState("");
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [message, setMessage] = useState("Choose a PNG, JPEG or WebP image.");
  const [busy, setBusy] = useState(false);
  /** Seeds the last run used; sent back only while the seed is locked. */
  const [seeds, setSeeds] = useState<Record<string, number>>({});
  const [lockSeed, setLockSeed] = useState(false);

  // Pick up an unfinished job from an earlier visit instead of losing it.
  // Deferred to after hydration: storage isn't available during prerender.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = recover(workflow);
      if (saved) {
        setJob(saved.job);
        setSeeds(saved.seeds);
        setMessage("Resuming the unfinished job…");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workflow]);

  // Heartbeat while a run is unresolved, also while polls fail or are paused,
  // so another tab doesn't mistake this one for gone and adopt its run.
  const watchedId = job && !job.terminal ? job.id : null;
  useEffect(() => {
    if (!watchedId) return;
    const timer = window.setInterval(() => touch(watchedId), TOUCH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [watchedId]);

  useEffect(() => {
    if (!job || job.terminal || pollRetry >= MAX_POLL_FAILURES) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const next = (await response.json()) as Job & { error?: unknown };
        if (!response.ok) {
          const detail = typeof next.error === "string" ? next.error : "Could not check job status.";
          if (isPermanent(response.status)) {
            forget(job);
            setJob(null);
            setPollRetry(0);
            setMessage(`${detail} This job can no longer be checked; start a new run.`);
            return;
          }
          throw new Error(detail);
        }
        remember(workflow, next);
        setJob(next);
        setPollRetry(0);
        setMessage(describeJob(next));
      } catch (cause) {
        touch(job.id);
        const detail = cause instanceof Error ? cause.message : "Could not check job status.";
        setMessage(
          pollRetry + 1 >= MAX_POLL_FAILURES
            ? `${detail} Paused checking; the job is still tracked. Resume checking when the service is back.`
            : detail,
        );
        setPollRetry((retry) => retry + 1);
      }
    }, pollRetry ? RETRY_MS : POLL_MS);
    return () => window.clearTimeout(timer);
  }, [job, pollRetry, workflow]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // An unfinished job is never silently replaced: starting another (billed)
    // run is the separate, explicit "Start a new run" action.
    if (!file || busy || unresolved) return;
    setBusy(true);
    setJob(null);
    setMessage("Uploading and submitting…");
    try {
      const body = new FormData();
      body.set("workflow", workflow);
      body.set("image", file);
      body.set("scale", String(scale));
      if (accessCode) body.set("access_code", accessCode);
      // Unlocked seeds are left out, so the server picks a fresh one per run.
      if (lockSeed) for (const [name, seed] of Object.entries(seeds)) body.set(name, String(seed));
      // Submitted exactly once: a retry would be a second, separately billed job.
      const response = await fetch("/api/jobs", { method: "POST", body });
      const next = (await response.json()) as SubmittedJob & { error?: unknown; code?: unknown };
      if (next.code === "access_code_required") setNeedsAccessCode(true);
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Unable to submit job.");
      setPollRetry(0);
      remember(workflow, next, next.seeds);
      setJob(next);
      setSeeds(next.seeds ?? {});
      setMessage(describeJob(next));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to submit job.");
    } finally {
      setBusy(false);
    }
  }

  const unresolved = Boolean(job && !job.terminal);
  const paused = unresolved && pollRetry >= MAX_POLL_FAILURES;
  const binding = getBinding(workflow);
  const hasSeed = binding ? seedInputs(binding).length > 0 : false;
  const lastSeeds = Object.values(seeds);

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <label className="block space-y-1 text-sm">
        <span>Image</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Scale ({scale.toFixed(2)}×)</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
          className="block w-full"
        />
      </label>
      {hasSeed && (
        <label className="flex items-center gap-2 text-sm">
          <input
            id="lock-seed"
            type="checkbox"
            checked={lockSeed}
            disabled={lastSeeds.length === 0}
            onChange={(event) => setLockSeed(event.target.checked)}
          />
          <span>
            Lock seed {lastSeeds.length ? `(${lastSeeds.join(", ")})` : "(available after the first run)"}
          </span>
        </label>
      )}
      {needsAccessCode && (
        <label className="block space-y-1 text-sm">
          <span>Access code</span>
          <input
            type="password"
            autoComplete="off"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            className="block w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={!file || busy || unresolved}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy || unresolved ? "Working…" : "Run"}
        </button>
        {paused && (
          <button
            type="button"
            onClick={() => {
              setPollRetry(0);
              setMessage("Checking again…");
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Resume checking
          </button>
        )}
        {paused && (
          <button
            type="button"
            onClick={() => {
              forget(job);
              setJob(null);
              setPollRetry(0);
              setMessage("Stopped watching the previous job (the server still enforces its time limit).");
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted"
          >
            Start a new run
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </p>
      {unresolved && !paused && (
        // No value = indeterminate: we only show a fraction the server reported.
        <progress max={1} value={job?.progress ?? undefined} aria-label="Job progress" className="block w-full" />
      )}
      {job?.outputs
        .filter((output) => output.type === "image")
        .map((output) => (
          // eslint-disable-next-line @next/next/no-img-element -- re-hosted job output, not a static asset
          <img key={output.id} src={output.url} alt={output.name} className="max-h-96 rounded-lg border border-border" />
        ))}
    </form>
  );
}
