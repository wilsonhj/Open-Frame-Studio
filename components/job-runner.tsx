"use client";

/**
 * Generic submit-and-poll runner. Polling pattern adapted from
 * Comfy-Org/comfy-reshoot `components/app-runner.tsx` (MIT).
 */
import { useEffect, useState } from "react";

import type { Job } from "../lib/types";

const POLL_MS = 2_000;
const RETRY_MS = 5_000;
/**
 * Stop after this many failed polls in a row. The job deadline itself is
 * enforced server-side (the status route cancels overdue jobs), so the
 * client just keeps polling until the server says the job is terminal.
 */
const MAX_POLL_FAILURES = 60;

export function JobRunner({ workflow = "image_resize_smoke" }: { workflow?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(0.5);
  const [job, setJob] = useState<Job | null>(null);
  const [pollRetry, setPollRetry] = useState(0);
  const [accessCode, setAccessCode] = useState("");
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [message, setMessage] = useState("Choose a PNG, JPEG or WebP image.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || job.terminal || pollRetry >= MAX_POLL_FAILURES) return;
    const timer = window.setTimeout(async () => {
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
        const detail = cause instanceof Error ? cause.message : "Could not check job status.";
        setMessage(pollRetry + 1 >= MAX_POLL_FAILURES ? `${detail} Stopped checking; reload to try again.` : detail);
        setPollRetry((retry) => retry + 1);
      }
    }, pollRetry ? RETRY_MS : POLL_MS);
    return () => window.clearTimeout(timer);
  }, [job, pollRetry]);

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
      if (accessCode) body.set("access_code", accessCode);
      // Submitted exactly once: a retry would be a second, separately billed job.
      const response = await fetch("/api/jobs", { method: "POST", body });
      const next = (await response.json()) as Job & { error?: unknown; code?: unknown };
      if (next.code === "access_code_required") setNeedsAccessCode(true);
      if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Unable to submit job.");
      setPollRetry(0);
      setJob(next);
      setMessage("Submitted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to submit job.");
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(job && !job.terminal && pollRetry < MAX_POLL_FAILURES);

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
