import { NextResponse } from "next/server";

import { ComfyNotConfiguredError, createClient, getJob } from "../../../../lib/comfy.ts";

export const runtime = "nodejs";

/** GET /api/jobs/:id -> normalized Job (single poll; the client re-polls). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = await getJob(createClient(), id);
    return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ComfyNotConfiguredError ? 503 : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to check job." },
      { status },
    );
  }
}
