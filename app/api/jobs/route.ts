import type { Comfy } from "@comfyorg/sdk";

import { AccessError, accessErrorResponse, assertMaySubmit, createJobHandle } from "../../../lib/access.ts";
import { applyBindings } from "../../../lib/bindings/apply.ts";
import { getBinding } from "../../../lib/bindings/index.ts";
import { prepareGraph } from "../../../lib/bindings/prepare.ts";
import {
  ComfyNotConfiguredError,
  SubmitAmbiguousError,
  SubmitRejectedError,
  createClient,
  loadGraph,
  rejectedSubmitMessage,
  rejectedSubmitStatus,
  submitOnce,
  withPublicId,
} from "../../../lib/comfy.ts";
import { InputError, parseInputs, seedsOf } from "../../../lib/inputs.ts";
import { recordJob } from "../../../lib/job-deadlines.ts";
import type { SubmittedJob } from "../../../lib/types.ts";

export const runtime = "nodejs";

/**
 * POST /api/jobs (multipart/form-data)
 *   workflow=<binding name>, access_code=<STUDIO_ACCESS_CODE if set>, plus one field per bound input.
 * -> 202 { id: <signed handle>, status, ..., seeds } on submit (`seeds`: the value
 * each `randomize` input ran with, so the UI can lock it). Submitted exactly once
 * under a fresh idempotency key (never retried; this route keeps no run state
 * to re-send from). The job's deadline is persisted and enforced server-side.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send multipart/form-data." }, { status: 400 });
  }

  const name = form.get("workflow");
  const bindingName = typeof name === "string" ? name : "";
  const binding = getBinding(bindingName);
  if (!binding) return Response.json({ error: "Unknown workflow." }, { status: 400 });

  let refundSlot: () => void;
  try {
    const accessCode = form.get("access_code");
    refundSlot = assertMaySubmit(request, typeof accessCode === "string" ? accessCode : null);
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    throw error;
  }

  // Created on first use, after every field has validated, so a bad form is a
  // 400 even when Comfy is not configured.
  let client: Comfy | undefined;
  let accepted = false;
  try {
    const values = await parseInputs(binding, form, async (file) => {
      client ??= createClient();
      return client.assets.fromBytes(new Uint8Array(await file.arrayBuffer()), {
        filename: file.name || "upload.png",
        contentType: file.type,
      });
    });
    client ??= createClient();
    const graph = applyBindings(prepareGraph(binding.workflow, await loadGraph(binding.workflow), values), binding, values);
    const workflow = client.workflows.fromJson(graph);
    const submitted = await submitOnce(client, workflow, { idempotencyKey: crypto.randomUUID() });
    accepted = true;
    const submittedAt = Date.now();
    await recordJob(submitted.id, binding.workflow, submittedAt);
    const handle = createJobHandle({ binding: bindingName, submittedAt, jobId: submitted.id });
    const job: SubmittedJob = {
      ...withPublicId(submitted, handle, Object.values(binding.outputs)),
      seeds: seedsOf(binding, values),
    };
    return Response.json(job, { status: 202 });
  } catch (error) {
    // Nothing was billed unless Comfy may have accepted the job: give the slot back.
    if (!accepted && !(error instanceof SubmitAmbiguousError)) refundSlot();
    if (error instanceof InputError) {
      return Response.json({ error: error.message, field: error.field }, { status: 400 });
    }
    if (error instanceof AccessError) return accessErrorResponse(error);
    if (error instanceof ComfyNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof SubmitAmbiguousError) {
      // The job may exist; do not tell the client to retry blindly.
      return Response.json(
        { error: "The submit outcome is unknown; a job may have been created.", code: "submit_ambiguous" },
        { status: 502 },
      );
    }
    if (error instanceof SubmitRejectedError) {
      return Response.json(
        { error: rejectedSubmitMessage(error), code: error.code, details: error.details },
        { status: rejectedSubmitStatus(error.httpStatus) },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to submit job." },
      { status: 502 },
    );
  }
}
