/**
 * STUB (W2.0 skeleton). Owner: slice A (docs/OWNERS.md).
 * GET /api/pipelines/{kind}/{runId}: run snapshot from the store, `no-store`
 * (docs/spec/api.md §2, §2.0). Answers 501 until slice A lands; an unknown
 * kind is 404.
 */
import { NextResponse } from "next/server";

import { isPipelineKind } from "../../../../../lib/pipeline/kinds.ts";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; runId: string }> }) {
  const { kind } = await params;
  if (!isPipelineKind(kind)) {
    return NextResponse.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  return NextResponse.json(
    { error: `Pipeline "${kind}" runs are not implemented yet.`, code: "not_implemented" },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
