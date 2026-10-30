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
      return `Waiting for a GPU (${job.queuePosition <= 0 ? "next up" : `#${job.queuePosition} in line`})…`;
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
