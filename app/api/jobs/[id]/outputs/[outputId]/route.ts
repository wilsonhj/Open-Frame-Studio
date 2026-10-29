import {
  ComfyNotConfiguredError,
  OutputNotFoundError,
  createClient,
  fetchOutput,
} from "../../../../../../lib/comfy.ts";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:id/outputs/:outputId -> streams the output bytes.
 * Re-hosts the short-lived signed URL so the browser never sees it.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; outputId: string }> }) {
  try {
    const { id, outputId } = await params;
    const output = await fetchOutput(createClient(), id, outputId);
    return new Response(output.body, {
      headers: {
        "Content-Type": output.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const status =
      error instanceof OutputNotFoundError ? 404 : error instanceof ComfyNotConfiguredError ? 503 : 502;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to download output." },
      { status },
    );
  }
}
