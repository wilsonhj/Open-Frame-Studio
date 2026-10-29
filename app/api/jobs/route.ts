import { NextResponse } from "next/server";

import { getBinding } from "../../../lib/bindings/index.ts";
import {
  ComfyNotConfiguredError,
  SubmitRejectedError,
  createClient,
  loadWorkflow,
  submitOnce,
} from "../../../lib/comfy.ts";
import { InputError, applyInputs, resolveInputs } from "../../../lib/inputs.ts";

export const runtime = "nodejs";

/**
 * POST /api/jobs (multipart/form-data)
 *   workflow=<binding name>  plus one field per bound input.
 * -> 202 { id, status, ... } on submit. Submitted exactly once (never retried).
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

  try {
    const client = createClient();
    const workflow = await loadWorkflow(client, binding.workflow);
    await applyInputs(workflow, binding, values, async (file) =>
      client.assets.fromBytes(new Uint8Array(await file.arrayBuffer()), {
        filename: file.name || "upload.png",
        contentType: file.type,
      }),
    );
    const job = await submitOnce(client, workflow);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof ComfyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof SubmitRejectedError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.httpStatus === 402 ? 402 : 422 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit job." },
      { status: 502 },
    );
  }
}
