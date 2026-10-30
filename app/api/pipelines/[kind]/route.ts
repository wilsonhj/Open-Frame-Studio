/**
 * POST /api/pipelines/{kind}: validate → upload → plan → persist → 202
 * PipelineRun<kind> (docs/spec/api.md §2, §2.0). Body: `application/json`
 * (the bare request) or `multipart/form-data` with a `request` JSON part and
 * one file part per `{ "upload": name }`.
 */

import { ComfyNotConfiguredError } from "../../../../lib/comfy.ts";
import { isPipelineKind } from "../../../../lib/pipeline/kinds.ts";
import { gateSubmit } from "../../../../lib/pipeline/gate.ts";
import { createRun, type UploadPart } from "../../../../lib/pipeline/runner.ts";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPipelineKind(kind)) {
    return Response.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  let raw: unknown;
  let formCode: string | null = null;
  const uploads = new Map<string, UploadPart>();
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const part = form.get("request");
      const text = typeof part === "string" ? part : part ? await part.text() : "";
      raw = JSON.parse(text);
      const code = form.get("access_code");
      formCode = typeof code === "string" ? code : null;
      for (const [name, value] of form.entries()) {
        if (name === "request" || typeof value === "string") continue;
        uploads.set(name, {
          bytes: new Uint8Array(await value.arrayBuffer()),
          filename: value.name || `${name}.png`,
          contentType: value.type || "application/octet-stream",
        });
      }
    } else {
      raw = await request.json();
    }
  } catch {
    return Response.json({ error: "Send JSON, or multipart with a `request` JSON part.", field: "" }, { status: 400 });
  }
  // A run submits billed Comfy jobs: same access policy as /api/jobs.
  const gate = gateSubmit(request, formCode);
  if (gate instanceof Response) return gate;
  try {
    const created = await createRun(kind, raw, uploads);
    if (!created.ok) {
      gate.refund(); // rejected before any job was submitted
      return Response.json({ error: created.error, field: created.field ?? "" }, { status: created.status });
    }
    return Response.json(created.run, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    gate.refund();
    if (error instanceof ComfyNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start run." }, { status: 502 });
  }
}
