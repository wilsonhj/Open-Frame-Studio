import { AccessError, accessErrorResponse, readJobHandle } from "../../../../lib/access.ts";
import { getBinding } from "../../../../lib/bindings/index.ts";
import { ComfyNotConfiguredError, createClient, getJob, overdueJob } from "../../../../lib/comfy.ts";
import {
  clearMissing,
  confirmMissing,
  enforceDeadline,
  forgetJob,
  jobBudgetMs,
  readRecord,
  sweepJobs,
} from "../../../../lib/job-deadlines.ts";
import type { Job } from "../../../../lib/types.ts";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:handle -> normalized Job (single poll; the client re-polls).
 * Only a caller holding the signed handle can read it. Past its budget a live
 * job gets a cancel request but stays non-terminal until Comfy confirms it,
 * so the browser keeps watching it instead of starting another paid run.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  let id = "";
  let jobId = "";
  try {
    id = (await params).id;
    const handle = readJobHandle(id);
    jobId = handle.jobId;
    // A handle for a workflow no longer registered can't be filtered to its
    // declared outputs, so refuse it rather than expose every node.
    const binding = getBinding(handle.binding);
    if (!binding) throw new AccessError(404, "job_not_found", "Job not found.");
    const client = createClient();
    void sweepJobs(); // opportunistic: also covers hosts where the interval can't run
    const options = { publicId: id, outputNodes: Object.values(binding.outputs) };
    let job = await getJob(client, handle.jobId, undefined, options);
    if (job.terminal) {
      // Also ends any run of 404s.
      await forgetJob(handle.jobId).catch(() => undefined);
    } else {
      // The deadline saved at submit wins, so a later JOB_DEADLINE_MS change
      // doesn't move it; the handle's submit time is the fallback when no
      // record could be saved. One read, shared by the calls below.
      const record = await readRecord(handle.jobId);
      await clearMissing(handle.jobId, record);
      const saved = Number.isFinite(record?.deadlineAt) && Number.isFinite(record?.submittedAt) ? record : null;
      const budget = saved ? saved.deadlineAt - saved.submittedAt : jobBudgetMs();
      const deadlineAt = saved ? saved.deadlineAt : handle.submittedAt + budget;
      const outcome = await enforceDeadline(client, handle.jobId, deadlineAt, Date.now(), record);
      if (outcome === "canceled") job = await getJob(client, handle.jobId, undefined, options);
      else if (outcome !== null) job = overdueJob(job, outcome, budget);
    }
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    if (jobId && (error as { httpStatus?: number }).httpStatus === 404) {
      // Final only once Comfy has kept answering 404 for MISSING_GRACE_MS: a
      // single 404 may be transient or a misconfigured proxy, and the job may
      // still be running. Until then keep the deadline and ask the browser to
      // retry (5xx, not a permanent 4xx).
      if (await confirmMissing(jobId).catch(() => false)) {
        await forgetJob(jobId).catch(() => undefined);
        return Response.json(goneJob(id), { headers: { "Cache-Control": "no-store" } });
      }
      return Response.json(
        { error: "Comfy can't find this job right now; still checking.", code: "job_missing" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
      );
    }
    const status = error instanceof ComfyNotConfiguredError ? 503 : 502;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to check job." },
      { status },
    );
  }
}

function goneJob(id: string): Job {
  return {
    id,
    status: "expired",
    terminal: true,
    progress: null,
    step: null,
    queuePosition: null,
    outputs: [],
    error: { code: "job_not_found", message: "Comfy no longer has this job; start a new run." },
  };
}
