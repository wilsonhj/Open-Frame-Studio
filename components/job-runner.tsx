"use client";

/**
 * Generic submit-and-poll runner. Polling pattern adapted from
 * Comfy-Org/comfy-reshoot `components/app-runner.tsx` (MIT).
 */
import { useEffect, useState } from "react";

import type { Job } from "../lib/types";

const POLL_MS = 2_000;
const RETRY_MS = 5_000;
/** Give up client-side after this long without a terminal status. */
const CLIENT_DEADLINE_MS = 15 * 60_000;

export function JobRunner({ workflow = "image_resize_smoke" }: { workflow?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(0.5);
  const [job, setJob] = useState<Job | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [pollRetry, setPollRetry] = useState(0);
  const [message, setMessage] = useState("Choose a PNG, JPEG or WebP image.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || job.terminal) return;
    const timer = window.setTimeout(async () => {
      if (Date.now() - startedAt > CLIENT_DEADLINE_MS) {
        setJob({ ...job, terminal: true, error: { code: "poll_timeout", message: "Gave up waiting for the job." } });
        setMessage("Gave up waiting for the job.");
        return;
      }
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const next = (await response.json()) as Job & { error?: unknown };
        if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Could not check job status.");
        setJob(next);
        setPollRetry(0);
        setMessage(
          next.status === "queued"
            ? "Waiting for a GPU…"
            : next.status === "running"
              ? `Running${next.progress !== null ? ` (${Math.round(next.progress * 100)}%)` : ""}…`
              : next.status === "succeeded"
                ? "Done."
                : next.error?.message ?? `Job ${next.status}.`,
        );
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Could not check job status.");
        setPollRetry((retry) => retry + 1);
      }
    }, pollRetry ? RETRY_MS : POLL_MS);
    return () => window.clearTimeout(timer);
  }, [job, pollRetry, startedAt]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setJob(null);
    setMessage("Uploading and submitting…");
    try {
      const body = new FormData();
      body.set("workflow", workflow);
      body.set("image", file);
      body.set("scale", String(scale));
      // Submitted exactly once: a retry would be a second, separately billed job.
      const response = await fetch("/api/jobs", { method: "POST", body });
      const next = (await response.json()) as Job & { error?: unknown };
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Unable to submit job.");
      setStartedAt(Date.now());
      setJob(next);
      setMessage("Submitted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to submit job.");
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(job && !job.terminal);

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
      <button
        type="submit"
        disabled={!file || busy || running}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy || running ? "Working…" : "Run"}
      </button>
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
