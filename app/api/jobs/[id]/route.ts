import { NextResponse } from "next/server";

import { AccessError, accessErrorResponse, readJobHandle } from "../../../../lib/access.ts";
import { getBinding } from "../../../../lib/bindings/index.ts";
import { ComfyNotConfiguredError, createClient, getJob, overdueJob } from "../../../../lib/comfy.ts";
import { enforceDeadline, forgetJob, jobBudgetMs, sweepJobs } from "../../../../lib/job-deadlines.ts";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:handle -> normalized Job (single poll; the client re-polls).
 * Only a caller holding the signed handle can read it. Past its budget a live
 * job gets a cancel request but stays non-terminal until Comfy confirms it,
 * so the browser keeps watching it instead of starting another paid run.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const handle = readJobHandle(id);
    const binding = getBinding(handle.binding);
    const client = createClient();
    void sweepJobs(); // opportunistic: also covers hosts where the interval can't run
    const options = { publicId: id, outputNodes: binding ? Object.values(binding.outputs) : undefined };
    let job = await getJob(client, handle.jobId, undefined, options);
    if (job.terminal) {
      await forgetJob(handle.jobId).catch(() => undefined);
    } else {
      const budget = jobBudgetMs();
      const outcome = await enforceDeadline(client, handle.jobId, handle.submittedAt + budget);
      if (outcome === "canceled") job = await getJob(client, handle.jobId, undefined, options);
      else if (outcome !== null) job = overdueJob(job, outcome, budget);
    }
    return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    const status = error instanceof ComfyNotConfiguredError ? 503 : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to check job." },
      { status },
    );
  }
}
