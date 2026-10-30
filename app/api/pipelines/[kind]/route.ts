/**
 * POST /api/pipelines/{kind}: validate → upload → plan → persist → 202
 * PipelineRun<kind> (docs/spec/api.md §2, §2.0). Body: `application/json`
 * (the bare request) or `multipart/form-data` with a `request` JSON part and
 * one file part per `{ "upload": name }`.
 */
import { NextResponse } from "next/server";

import { ComfyNotConfiguredError } from "../../../../lib/comfy.ts";
import { isPipelineKind } from "../../../../lib/pipeline/kinds.ts";
import { createRun, type UploadPart } from "../../../../lib/pipeline/runner.ts";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPipelineKind(kind)) {
    return NextResponse.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  let raw: unknown;
  const uploads = new Map<string, UploadPart>();
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const part = form.get("request");
      const text = typeof part === "string" ? part : part ? await part.text() : "";
      raw = JSON.parse(text);
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
    return NextResponse.json({ error: "Send JSON, or multipart with a `request` JSON part.", field: "" }, { status: 400 });
  }
  try {
    const created = await createRun(kind, raw, uploads);
    if (!created.ok) {
      return NextResponse.json({ error: created.error, field: created.field ?? "" }, { status: created.status });
    }
    return NextResponse.json(created.run, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ComfyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start run." }, { status: 502 });
  }
}
