/**
 * STUB (W2.0 skeleton). Owner: slice A (docs/OWNERS.md).
 * POST /api/pipelines/{kind}: validate → upload → plan → persist → 202
 * PipelineRun<kind> (docs/spec/api.md §2, §2.0). Answers 501 until slice A
 * lands; an unknown kind is 404.
 */
import { NextResponse } from "next/server";

import { isPipelineKind } from "../../../../lib/pipeline/kinds.ts";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPipelineKind(kind)) {
    return NextResponse.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  return NextResponse.json({ error: `Pipeline "${kind}" is not implemented yet.`, code: "not_implemented" }, { status: 501 });
}
