"use client";

/**
 * Generic submit-and-poll runner. Polling pattern adapted from
 * Comfy-Org/comfy-reshoot `components/app-runner.tsx` (MIT).
 */
import { useEffect, useState } from "react";

import { forgetJob, recoverJob, rememberJob, tabId } from "../lib/job-recovery";
import type { Job } from "../lib/types";

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
function remember(workflow: string, job: Job): void {
  try {
    rememberJob(window.localStorage, tabId(window.sessionStorage), workflow, job);
  } catch {}
}

function forget(job: Job | null): void {
  try {
    if (job) forgetJob(window.localStorage, job.id);
  } catch {}
}

function recover(workflow: string): Job | null {
  try {
    return recoverJob(window.localStorage, tabId(window.sessionStorage), workflow);
  } catch {
    return null;
  }
}

/** A 4xx other than timeout/rate-limit won't change on retry (e.g. 404: the handle is no longer valid). */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function describe(job: Job): string {
  if (job.status === "succeeded") return "Done.";
  // Before the status: an over-budget or timed-out job can still carry a live status.
  if (job.error) return job.error.message;
  if (job.status === "queued") return "Waiting for a GPU…";
  if (job.status === "running") return `Running${job.progress !== null ? ` (${Math.round(job.progress * 100)}%)` : ""}…`;
  return `Job ${job.status}.`;
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

  // Pick up an unfinished job from an earlier visit instead of losing it.
  // Deferred to after hydration: storage isn't available during prerender.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = recover(workflow);
      if (saved) {
        setJob(saved);
        setMessage("Resuming the unfinished job…");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workflow]);


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
        setMessage(describe(next));
      } catch (cause) {
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
      // Submitted exactly once: a retry would be a second, separately billed job.
      const response = await fetch("/api/jobs", { method: "POST", body });
      const next = (await response.json()) as Job & { error?: unknown; code?: unknown };
      if (next.code === "access_code_required") setNeedsAccessCode(true);
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Unable to submit job.");
      setPollRetry(0);
      remember(workflow, next);
      setJob(next);
      setMessage("Submitted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to submit job.");
    } finally {
      setBusy(false);
    }
  }

  const unresolved = Boolean(job && !job.terminal);
  const paused = unresolved && pollRetry >= MAX_POLL_FAILURES;

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
      {job?.outputs
        .filter((output) => output.type === "image")
        .map((output) => (
          // eslint-disable-next-line @next/next/no-img-element -- re-hosted job output, not a static asset
          <img key={output.id} src={output.url} alt={output.name} className="max-h-96 rounded-lg border border-border" />
        ))}
    </form>
  );
}
