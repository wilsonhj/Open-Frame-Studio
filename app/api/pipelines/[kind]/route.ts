/**
 * POST /api/pipelines/{kind}: validate → upload → plan → persist → 202
 * PipelineRun<kind> (docs/spec/api.md §2, §2.0). Body: `application/json`
 * (the bare request) or `multipart/form-data` with a `request` JSON part and
 * one file part per `{ "upload": name }`. The studio access code travels in
 * the `X-Access-Code` header, so the access check and the size cap run before
 * any of the body is read.
 */

import { ComfyNotConfiguredError } from "../../../../lib/comfy.ts";
import { isPipelineKind } from "../../../../lib/pipeline/kinds.ts";
import { gateSubmit } from "../../../../lib/pipeline/gate.ts";
import { MAX_UPLOAD_PARTS, createRun, uploadNames, type UploadPart } from "../../../../lib/pipeline/runner.ts";

/** Largest body accepted: MAX_UPLOAD_PARTS images of 20 MB plus 1 MB for the request JSON and multipart framing. */
export const MAX_BODY_BYTES = MAX_UPLOAD_PARTS * 20 * 1024 * 1024 + 1024 * 1024;

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPipelineKind(kind)) {
    return Response.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  // Refuse an oversized body by its declared length, before reading it.
  const length = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large.", field: "" }, { status: 413 });
  }
  // A run submits billed Comfy jobs: same access policy as /api/jobs, checked
  // from the header before the body is read or buffered.
  const gate = gateSubmit(request);
  if (gate instanceof Response) return gate;
  let raw: unknown;
  const uploads = new Map<string, UploadPart>();
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const part = form.get("request");
      const text = typeof part === "string" ? part : part ? await part.text() : "";
      raw = JSON.parse(text);
      // Copy only the parts the request references, and refuse too many parts
      // before copying any of them.
      const wanted = new Set(uploadNames(raw));
      const files = [...form.entries()].filter(([name, value]) => name !== "request" && typeof value !== "string");
      if (files.length > MAX_UPLOAD_PARTS) {
        gate.refund();
        return Response.json({ error: `At most ${MAX_UPLOAD_PARTS} files per request.`, field: "" }, { status: 400 });
      }
      for (const [name, value] of files) {
        if (!wanted.has(name) || typeof value === "string") continue;
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
    gate.refund();
    return Response.json({ error: "Send JSON, or multipart with a `request` JSON part.", field: "" }, { status: 400 });
  }
  try {
    const created = await createRun(kind, raw, uploads);
    if (!created.ok) {
      // Refused before any job was submitted. A refusal that already uploaded
      // assets keeps its slot, so failed requests can't be free uploads.
      if (!created.assetsCreated) gate.refund();
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
