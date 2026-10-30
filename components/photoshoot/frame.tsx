/**
 * One contact-sheet frame: status, image, caption strip with the variation
 * axes (docs/spec/ux.md §5.3, §7). No fake percentages.
 */
import { StatusPill } from "../ui";
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
};

const STATUS_COPY: Partial<Record<PipelineStepStatus, string>> = {
  pending: "waiting",
  queued: "waiting for GPU",
  running: "developing",
  succeeded: "done",
  timed_out: "timed out",
};

export function Frame({ index, label, aspect, status, waitingNote, output, error, variation, onRetry }: FrameProps) {
  const [w, h] = aspect.split(":").map(Number);
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
        {output ? (
          // eslint-disable-next-line @next/next/no-img-element -- re-hosted run output, sizes unknown
          <img src={output.url} alt={`${label} ${index + 1}`} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center font-mono text-[11px] text-[var(--ps-film-ink)]">
            <span className="text-2xl opacity-40">{String(index + 1).padStart(2, "0")}</span>
            <span>{failed ? (error?.code ?? status) : (STATUS_COPY[status] ?? status)}</span>
            {!failed && waitingNote ? <span className="opacity-60">{waitingNote}</span> : null}
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-1 font-mono text-[11px] leading-snug text-muted">
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground">
            {label} {String(index + 1).padStart(2, "0")}
          </span>
          <StatusPill status={status} label={STATUS_COPY[status]} />
        </div>
        {variation ? (
          <span className="line-clamp-2" title={Object.values(variation).join(" · ")}>
            {[variation.preset, variation.lighting, variation.angle, variation.palette].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {failed && error ? (
          <span className="text-red-700 dark:text-red-400" role="alert">
            {error.code}: {error.message}
          </span>
        ) : null}
        <div className="flex gap-3">
          {output ? (
            <a className="underline decoration-dotted underline-offset-2 hover:text-foreground" href={output.url} download={output.name}>
              Download
            </a>
          ) : null}
          {failed && onRetry ? (
            <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={onRetry}>
              Retry (new seed)
            </button>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
