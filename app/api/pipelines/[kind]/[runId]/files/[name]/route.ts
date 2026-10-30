/** GET /api/pipelines/{kind}/{runId}/files/{name}: bytes of a run file (docs/spec/api.md §2). */
import { isPipelineKind } from "../../../../../../../lib/pipeline/kinds.ts";
import { loadRun, readRunFile } from "../../../../../../../lib/store.ts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; runId: string; name: string }> },
) {
  const { kind, runId, name } = await params;
  const run = isPipelineKind(kind) ? await loadRun(runId) : null;
  const bytes = run && run.kind === kind ? await readRunFile(runId, name) : null;
  if (!run || !bytes) return Response.json({ error: "File not found." }, { status: 404 });
  const ref = run.steps.flatMap((s) => s.outputs ?? []).find((o) => o.url.endsWith(`/files/${encodeURIComponent(name)}`));
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": ref?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
