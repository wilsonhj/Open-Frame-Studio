"use client";
/**
 * One contact-sheet frame: status, image, caption strip with the variation
 * axes (docs/spec/ux.md §5.3, §7). No fake percentages.
 */
import { useState } from "react";

import { StatusPill } from "../ui";
import { Upscale } from "./upscale";
import { errorDetail, humanReason } from "../../lib/photoshoot/copy";
import type { JobErrorInfo, OutputRef, PipelineStepStatus, VariationPick } from "../../lib/types";

export type FrameProps = {
  index: number;
  label: string;
  aspect: string;
  status: PipelineStepStatus;
  /** Shown under the pill while the step waits (e.g. "after cutout"). */
  waitingNote?: string;
  output: OutputRef | null;
  error: JobErrorInfo | null;
  variation: VariationPick | null;
  onRetry?: () => void;
  /** Jobs a retry submits: 1, or 2 when it must also re-run a failed cutout. */
  retryJobs?: number;
  /** A retry request for this frame is in flight. */
  retrying?: boolean;
  /** Offer "Upscale 2×" on a finished frame. */
  upscalable?: boolean;
};

const STATUS_COPY: Partial<Record<PipelineStepStatus, string>> = {
  pending: "waiting",
  queued: "waiting for GPU",
  running: "developing",
  succeeded: "done",
  timed_out: "timed out",
};

/** The caption pill is narrow on 4-up sheets: short words (the frame body keeps the long copy). */
const PILL_COPY: Partial<Record<PipelineStepStatus, string>> = { ...STATUS_COPY, queued: "queued" };

export function Frame({
  index,
  label,
  aspect,
  status,
  waitingNote,
  output,
  error,
  variation,
  onRetry,
  retryJobs = 1,
  retrying = false,
  upscalable = false,
}: FrameProps) {
  const [w, h] = aspect.split(":").map(Number);
  // The upscale of THIS output (a retried frame has a new output, so an older upscale is ignored).
  const [upscaled, setUpscaled] = useState<{ from: string; ref: OutputRef } | null>(null);
  const shown = output && upscaled?.from === output.id ? upscaled.ref : output;
  const live = status === "queued" || status === "running";
  // A skipped frame (its cutout failed) is retryable too: the retry action
  // re-runs the failed cutout along with the frame.
  const failed =
    status === "failed" || status === "timed_out" || status === "canceled" || status === "expired" || status === "skipped";
  return (
    <figure className="flex flex-col gap-2" data-testid={`frame-${index}`}>
      <div
        className={`ps-frame relative overflow-hidden rounded-md border border-border bg-[var(--ps-film)] ${live ? "ps-live" : ""}`}
        style={{ aspectRatio: `${w || 1} / ${h || 1}` }}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- re-hosted run output, sizes unknown
          <img src={shown.url} alt={`${label} ${index + 1}`} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center font-mono text-[11px] text-[var(--ps-film-ink)]">
            <span className="text-2xl opacity-40">{String(index + 1).padStart(2, "0")}</span>
            <span>{STATUS_COPY[status] ?? status}</span>
            {!failed && waitingNote ? <span className="opacity-60">{waitingNote}</span> : null}
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-1 font-mono text-[11px] leading-snug text-muted">
        {/* One line on narrow 4-up frames: the label never wraps; a long pill truncates. */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 whitespace-nowrap text-foreground">
            {label} {String(index + 1).padStart(2, "0")}
          </span>
          <StatusPill
            status={status}
            label={PILL_COPY[status]}
            className="min-w-0 truncate whitespace-nowrap"
          />
        </div>
        {variation ? (
          <span className="line-clamp-2" title={Object.values(variation).join(" · ")}>
            {[variation.preset, variation.lighting, variation.angle, variation.palette].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {failed && error ? (
          <span className="text-red-700 dark:text-red-400" role="alert" title={errorDetail(error)}>
            {humanReason(error)}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {output ? (
            <a className="underline decoration-dotted underline-offset-2 hover:text-foreground" href={output.url} download={output.name}>
              Download
            </a>
          ) : null}
          {output && upscalable && status === "succeeded" ? (
            <Upscale
              key={output.id}
              output={output}
              onResult={(ref) => setUpscaled(ref ? { from: output.id, ref } : null)}
            />
          ) : null}
          {failed && onRetry ? (
            <button
              type="button"
              disabled={retrying}
              title="New seed; billed as new Comfy jobs"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-wait disabled:opacity-50"
              onClick={onRetry}
            >
              {retrying ? "Retrying…" : `Retry · ${retryJobs} ${retryJobs === 1 ? "job" : "jobs"}`}
            </button>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
