import { AccessError, accessErrorResponse, readJobHandle } from "../../../../../../lib/access.ts";
import { getBinding } from "../../../../../../lib/bindings/index.ts";
import {
  ComfyNotConfiguredError,
  OutputNotFoundError,
  createClient,
  fetchOutput,
} from "../../../../../../lib/comfy.ts";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:handle/outputs/:outputId -> streams the output bytes.
 * Re-hosts the short-lived signed URL so the browser never sees it. Only a
 * holder of the signed job handle can read it, and only media types are served inline
 * (see outputResponseHeaders).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; outputId: string }> }) {
  try {
    const { id, outputId } = await params;
    const handle = readJobHandle(id);
    const binding = getBinding(handle.workflow);
    const output = await fetchOutput(createClient(), handle.jobId, outputId, {
      outputNodes: binding ? Object.values(binding.outputs) : undefined,
    });
    return new Response(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    const status =
      error instanceof OutputNotFoundError ? 404 : error instanceof ComfyNotConfiguredError ? 503 : 502;
    // Don't echo the raw Comfy job id back to the browser.
    const message = status === 404 ? "Output not found." : error instanceof Error ? error.message : "Unable to download output.";
    return Response.json({ error: message }, { status });
  }
}
