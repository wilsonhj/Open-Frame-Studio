/**
 * STUB (W2.0 skeleton). Owner: slice G (docs/OWNERS.md). Client hook that
 * starts and polls a pipeline run through the slice-A routes:
 *   POST /api/pipelines/{kind}            -> 202 PipelineRun<K>
 *   GET  /api/pipelines/{kind}/{runId}    -> 200 PipelineRun<K> (poll until terminal)
 *   POST /api/pipelines/{kind}/{runId}/cancel
 * Keep the export names and signatures (additive changes only). Use it from
 * a "use client" component. Until slice G lands it is inert: it never polls,
 * and start/cancel reject.
 */
import type { PipelineKind, PipelineRun } from "../types";

export type UseRunOptions = {
  /** Resume polling an existing run (e.g. from `?run=` or History). */
  runId?: string | null;
  /** Poll interval in ms (default 2000). */
  intervalMs?: number;
};

export type UseRunResult<K extends PipelineKind> = {
  run: PipelineRun<K> | null;
  /** Last request/poll error message (the run itself may still be fine). */
  error: string | null;
  /** True while a run is non-terminal and being polled. */
  polling: boolean;
  /**
   * Create a run. `FormData` = multipart (`request` JSON part + file parts);
   * a plain object = `application/json` (assetId-only requests). Resolves to
   * the 202 run, or `null` on a 4xx/5xx (see `error`).
   */
  start(body: FormData | PipelineRunRequestBody): Promise<PipelineRun<K> | null>;
  cancel(): Promise<void>;
  /** POST an action path under the run, e.g. `items/2/retry` (202 PipelineRun). */
  action(path: string, body?: unknown): Promise<PipelineRun<K> | null>;
  /** Forget the current run (stops polling). */
  reset(): void;
};

/** A JSON request body for `start` (the per-kind request object). */
export type PipelineRunRequestBody = Record<string, unknown>;

const NOT_IMPLEMENTED = "not implemented: useRun (slice G)";

export function useRun<K extends PipelineKind>(kind: K, options: UseRunOptions = {}): UseRunResult<K> {
  void kind;
  void options;
  return {
    run: null,
    error: null,
    polling: false,
    start: async () => Promise.reject(new Error(NOT_IMPLEMENTED)),
    cancel: async () => Promise.reject(new Error(NOT_IMPLEMENTED)),
    action: async () => Promise.reject(new Error(NOT_IMPLEMENTED)),
    reset: () => {},
  };
}
