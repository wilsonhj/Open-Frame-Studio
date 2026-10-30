/**
 * One-line status copy for a job. Shows only what the server reported:
 * queue position, the running node and its sampler step, and the
 * server-computed fraction. Nothing is estimated client-side.
 */
import type { Job } from "./types.ts";

export function describeJob(job: Job): string {
  if (job.status === "succeeded") return "Done.";
  // Before the status: an over-budget or timed-out job can still carry a live status.
  if (job.error) return job.error.message;
  switch (job.status) {
    case "queued":
      if (job.queuePosition === null) return "Waiting for a GPU…";
      // The API doesn't say whether positions start at 0 or 1: show the raw value.
      return `Waiting for a GPU (queue position ${job.queuePosition})…`;
    case "running": {
      const percent = job.progress !== null ? ` (${Math.round(job.progress * 100)}%)` : "";
      if (!job.step) return `Running${percent}…`;
      const node = job.step.nodeClass ? ` ${job.step.nodeClass}` : "";
      return `Running${node}: step ${job.step.current} of ${job.step.total}${percent}…`;
    }
    default:
      return `Job ${job.status}.`;
  }
}
