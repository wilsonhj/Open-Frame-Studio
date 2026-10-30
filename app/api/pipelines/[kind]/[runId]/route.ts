/**
 * GET /api/pipelines/{kind}/{runId}: run snapshot from the store, `no-store`
 * (docs/spec/api.md §2, §2.0). A non-terminal run not yet loaded is resumed.
 */

import { isPipelineKind } from "../../../../../lib/pipeline/kinds.ts";
import { getRun } from "../../../../../lib/pipeline/runner.ts";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; runId: string }> }) {
  const { kind, runId } = await params;
  if (!isPipelineKind(kind)) {
    return Response.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  const run = await getRun(runId);
  if (!run || run.kind !== kind) {
    return Response.json({ error: "Run not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
