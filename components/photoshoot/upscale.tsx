"use client";
/**
 * Per-frame "Upscale 2×": one SeedVR2 job through POST /api/jobs, polled
 * until terminal (lib/client/upscale.ts). The result is handed to the frame
 * (`onResult`) so it can show the sharper image; this strip shows status,
 * the output size and a download link. The job is kept in sessionStorage per
 * frame output, so a reload resumes it instead of offering a second billed job.
 */
import { useEffect, useState } from "react";

import { describeJob } from "../../lib/job-status";
import { UPSCALE_FACTOR, pollUpscale, submitUpscale } from "../../lib/client/upscale";
import type { Job, OutputRef } from "../../lib/types";

const POLL_MS = 2_000;
/** Give up after this many failed polls in a row (the server still enforces the job deadline). */
const MAX_POLL_FAILURES = 30;

type Size = { width: number; height: number };

const storageKey = (outputId: string) => `oss:upscale:${outputId}`;

function storedJob(outputId: string): Job | null {
  try {
    const job = JSON.parse(window.sessionStorage.getItem(storageKey(outputId)) ?? "null") as Job | null;
    return job && typeof job.id === "string" ? job : null;
  } catch {
    return null;
  }
}

function storeJob(outputId: string, job: Job | null) {
  try {
    if (job) window.sessionStorage.setItem(storageKey(outputId), JSON.stringify(job));
    else window.sessionStorage.removeItem(storageKey(outputId));
  } catch {
    // Storage unavailable (private mode): resume-on-reload is best effort.
  }
}

export function Upscale({ output, onResult }: { output: OutputRef; onResult(result: OutputRef | null): void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [size, setSize] = useState<Size | null>(null);

  const result = job?.status === "succeeded" ? (job.outputs.find((o) => o.type === "image") ?? null) : null;

  // Resume this tab's upscale of the frame (a reload drops component state).
  useEffect(() => {
    const stored = storedJob(output.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt a stored job from browser storage after hydration
    if (stored) setJob(stored);
  }, [output.id]);

  useEffect(() => {
    if (job) storeJob(output.id, job);
  }, [job, output.id]);

  useEffect(() => {
    if (!job || job.terminal || failures >= MAX_POLL_FAILURES) return;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await pollUpscale(job.id);
        if (stopped) return;
        if ("job" in next) {
          setFailures(0);
          setJob(next.job);
        } else if (next.permanent) {
          setError(next.error);
          setJob(null);
          storeJob(output.id, null);
        } else {
          setFailures((n) => n + 1);
        }
      } catch {
        if (!stopped) setFailures((n) => n + 1);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [job, failures, output.id]);

  useEffect(() => {
    onResult(result);
    if (!result) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      if (live) setSize({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.src = result.url;
    return () => {
      live = false;
    };
    // `onResult` is a parent setter; re-run only when the result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.url]);

  async function start() {
    if (busy || (job && !job.terminal)) return;
    setBusy(true);
    setError(null);
    setSize(null);
    setFailures(0);
    try {
      setJob(await submitUpscale(output));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const working = busy || (job !== null && !job.terminal);
  const failed = job !== null && job.terminal && job.status !== "succeeded";

  if (result) {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="upscale-result">
        <span className="text-foreground">
          Upscaled {UPSCALE_FACTOR}×{size ? ` · ${size.width}×${size.height}` : ""}
        </span>
        <a className="underline decoration-dotted underline-offset-2 hover:text-foreground" href={result.url} download={result.name}>
          Download {UPSCALE_FACTOR}×
        </a>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        disabled={working}
        title="SeedVR2 upscale; billed as one new Comfy job"
        className="underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        onClick={() => void start()}
      >
        {working ? "Upscaling…" : failed || error ? `Retry upscale ${UPSCALE_FACTOR}×` : `Upscale ${UPSCALE_FACTOR}×`}
      </button>
      {job && !job.terminal ? (
        <span className="min-w-0 truncate" role="status" title={describeJob(job)}>
          {failures >= MAX_POLL_FAILURES ? "Lost contact; still tracked server-side." : describeJob(job)}
        </span>
      ) : null}
      {failed || error ? (
        <span className="text-red-700 dark:text-red-400" role="alert">
          {error ?? (job ? describeJob(job) : "")}
        </span>
      ) : null}
    </span>
  );
}
