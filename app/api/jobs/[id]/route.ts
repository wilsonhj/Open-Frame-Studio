import { NextResponse } from "next/server";

import { AccessError, accessErrorResponse, readJobHandle } from "../../../../lib/access.ts";
import { getBinding } from "../../../../lib/bindings/index.ts";
import { ComfyNotConfiguredError, createClient, getJobWithDeadline } from "../../../../lib/comfy.ts";

export const runtime = "nodejs";

/** Server-side budget per job; past it the job is canceled so it stops billing. */
const JOB_DEADLINE_MS = 15 * 60_000;

/**
 * GET /api/jobs/:handle -> normalized Job (single poll; the client re-polls).
 * Only the browser session that submitted the job can read it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const handle = readJobHandle(request, id);
    const job = await getJobWithDeadline(createClient(), handle.jobId, {
      publicId: id,
      outputNodes: getBinding(handle.workflow)?.outputNodes,
      submittedAt: handle.submittedAt,
      deadlineMs: JOB_DEADLINE_MS,
    });
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
