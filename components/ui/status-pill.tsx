/**
 * Minimal primitive (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Keep the
 * export name and props (additive changes only); restyle freely.
 */
import type { CardTileState, PipelineRunStatus, PipelineStepStatus } from "../../lib/types";

export type StatusPillStatus = PipelineStepStatus | PipelineRunStatus | CardTileState;

export type StatusPillProps = {
  status: StatusPillStatus;
  /** Overrides the default label (the status with `_` as spaces). */
  label?: string;
  className?: string;
};

const TONE: Partial<Record<StatusPillStatus, string>> = {
  succeeded: "border-green-600/40 text-green-700 dark:text-green-400",
  failed: "border-red-600/40 text-red-700 dark:text-red-400",
  timed_out: "border-red-600/40 text-red-700 dark:text-red-400",
  partial: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  needs_input: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  running: "border-accent/40 text-accent",
  queued: "border-accent/40 text-accent",
};

export function StatusPill({ status, label, className = "" }: StatusPillProps) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${TONE[status] ?? "border-border text-muted"} ${className}`}
    >
      {label ?? status.replaceAll("_", " ")}
    </span>
  );
}
