import { NextResponse } from "next/server";

import { AccessError, accessErrorResponse, assertMaySubmit, createJobHandle, ensureSession } from "../../../lib/access.ts";
import { getBinding } from "../../../lib/bindings/index.ts";
import {
  ComfyNotConfiguredError,
  SubmitRejectedError,
  createClient,
  loadWorkflow,
  rejectedSubmitMessage,
  rejectedSubmitStatus,
  submitOnce,
  withPublicId,
} from "../../../lib/comfy.ts";
import { InputError, applyInputs, resolveInputs } from "../../../lib/inputs.ts";

export const runtime = "nodejs";

/**
 * POST /api/jobs (multipart/form-data)
 *   workflow=<binding name>, access_code=<STUDIO_ACCESS_CODE if set>, plus one field per bound input.
 * -> 202 { id: <signed handle>, status, ... } on submit. Submitted exactly once (never retried).
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data." }, { status: 400 });
  }

  const name = form.get("workflow");
  const binding = typeof name === "string" ? getBinding(name) : undefined;
  if (!binding) return NextResponse.json({ error: "Unknown workflow." }, { status: 400 });

  let values;
  try {
    values = resolveInputs(binding, form);
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    throw error;
  }

  let session;
  try {
    const accessCode = form.get("access_code");
    assertMaySubmit(request, typeof accessCode === "string" ? accessCode : null);
    session = ensureSession(request);
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    throw error;
  }

  try {
    const client = createClient();
    const workflow = await loadWorkflow(client, binding.workflow);
    await applyInputs(workflow, binding, values, async (file) =>
      client.assets.fromBytes(new Uint8Array(await file.arrayBuffer()), {
        filename: file.name || "upload.png",
        contentType: file.type,
      }),
    );
    const submitted = await submitOnce(client, workflow);
    const handle = createJobHandle(session.sid, {
      workflow: binding.workflow,
      submittedAt: Date.now(),
      jobId: submitted.id,
    });
    const job = withPublicId(submitted, handle, binding.outputNodes);
    const response = NextResponse.json(job, { status: 202 });
    if (session.setCookie) response.headers.append("Set-Cookie", session.setCookie);
    return response;
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    if (error instanceof ComfyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof SubmitRejectedError) {
      return NextResponse.json(
        { error: rejectedSubmitMessage(error), code: error.code, details: error.details },
        { status: rejectedSubmitStatus(error.httpStatus) },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit job." },
      { status: 502 },
    );
  }
}

