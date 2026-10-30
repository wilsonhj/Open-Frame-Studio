/** GET /api/pipelines/{kind}/{runId}/files/{stepId}/{name}: bytes of a step file (docs/spec/api.md §2). */
import { outputResponseHeaders } from "../../../../../../../../lib/comfy.ts";
import { isPipelineKind } from "../../../../../../../../lib/pipeline/kinds.ts";
import { loadRun, readRunFile } from "../../../../../../../../lib/store.ts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; runId: string; stepId: string; name: string }> },
) {
  const { kind, runId, stepId, name } = await params;
  const run = isPipelineKind(kind) ? await loadRun(runId) : null;
  const bytes = run && run.kind === kind ? await readRunFile(runId, `${stepId}/${name}`) : null;
  if (!run || !bytes) return Response.json({ error: "File not found." }, { status: 404 });
  const suffix = `/files/${encodeURIComponent(stepId)}/${encodeURIComponent(name)}`;
  const ref = run.steps.flatMap((s) => s.outputs ?? []).find((o) => o.url.endsWith(suffix));
  // Same safe headers as re-hosted job outputs: only raster/media types render
  // inline; anything else (HTML, SVG, text) is a sandboxed download.
  const headers = outputResponseHeaders(ref?.contentType || "application/octet-stream", name);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}
