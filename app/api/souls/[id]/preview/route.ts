/**
 * POST /api/souls/{id}/preview → 202 PipelineRun<"identity">: renders the
 * identity preview sheet (one klein_edit_multiref job; docs/spec/identity.md §2
 * step 8). Billed, so it takes a rate-limit slot like every other submit.
 * Only the saved crops go to Comfy (ensureAssets), never the originals.
 */
import { AccessError, accessErrorResponse } from "../../../../../lib/access.ts";
import { ComfyNotConfiguredError } from "../../../../../lib/comfy.ts";
import { errorResponse, NO_STORE } from "../../../../../lib/identity/http.ts";
import { gateSubmit, jobCharge } from "../../../../../lib/pipeline/gate.ts";
import { createRun } from "../../../../../lib/pipeline/runner.ts";
import { ensureAssets, getSoul } from "../../../../../lib/soul/registry.ts";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = gateSubmit(request);
  if (gate instanceof Response) return gate;
  const soul = await getSoul((await params).id).catch(() => null);
  if (!soul) {
    gate.refund();
    return Response.json({ error: "Identity not found." }, { status: 404, headers: NO_STORE });
  }
  if (!soul.consentedAt) {
    // Saved before consent was recorded: no job without it (§8.7).
    gate.refund();
    return Response.json(
      { error: "This identity has no likeness-consent record. Create or import it again.", field: "consent" },
      { status: 403, headers: NO_STORE },
    );
  }
  try {
    const ready = await ensureAssets(soul);
    const created = await createRun("identity", {
      name: ready.name,
      consent: true, // backed by soul.consentedAt, checked above
      photos: ready.refs.slice(0, 4).map((r) => ({ assetId: r.assetId })),
      preview: true,
    }, undefined, jobCharge(request));
    if (!created.ok) {
      gate.refund();
      if (created.status === 429) {
        return accessErrorResponse(new AccessError(429, created.code, created.error, created.retryAfterSeconds));
      }
      return Response.json({ error: created.error, field: created.field ?? "" }, { status: created.status, headers: NO_STORE });
    }
    return Response.json(created.run, { status: 202, headers: NO_STORE });
  } catch (error) {
    // Refused before any job was submitted (uploads of the crops are not jobs).
    gate.refund();
    if (error instanceof ComfyNotConfiguredError) return Response.json({ error: error.message }, { status: 503, headers: NO_STORE });
    return errorResponse(error);
  }
}
