/**
 * GET    /api/souls/{id} → Identity. Needs the access code when one is set,
 *        like the list: an identity is a face.
 * DELETE /api/souls/{id} → `{ deleted, assetsNotDeleted }`: removes the local folder
 *        and asks Comfy to delete each cached ref asset (docs/spec/identity.md §8.4).
 */
import { gateWrite } from "../../../../lib/pipeline/gate.ts";
import { errorResponse, NO_STORE } from "../../../../lib/identity/http.ts";
import { deleteIdentity, getSoul } from "../../../../lib/soul/registry.ts";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = gateWrite(request);
  if (denied) return denied;
  try {
    const soul = await getSoul((await params).id);
    if (!soul) return Response.json({ error: "Identity not found." }, { status: 404, headers: NO_STORE });
    return Response.json(soul, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = gateWrite(request);
  if (denied) return denied;
  try {
    const result = await deleteIdentity((await params).id);
    if (!result.deleted) return Response.json({ error: "Identity not found." }, { status: 404, headers: NO_STORE });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
