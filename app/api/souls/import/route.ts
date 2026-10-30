/**
 * POST /api/souls/import  multipart `consent` ("true") + `bundle` (.identity.zip)
 * → 201 Identity. The importer confirms likeness consent like any uploader
 * (checked before the bundle is read). The bundle is untrusted: schema, ref
 * count, paths, sha256 and photo QA are all checked again
 * (docs/spec/identity.md §6.5). Saved under a fresh id; the refs upload to
 * Comfy when a job first needs them (ensureAssets).
 */
import { assertIdentityConsent, IDENTITY_CONSENT_FIELD } from "../../../../lib/identity/consent.ts";
import { refuseBody } from "../../../../lib/identity/body.ts";
import { errorResponse, NO_STORE } from "../../../../lib/identity/http.ts";
import { gateWrite } from "../../../../lib/pipeline/gate.ts";
import { importBundle, MAX_BUNDLE_BYTES } from "../../../../lib/soul/registry.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = gateWrite(request) ?? refuseBody(request, MAX_BUNDLE_BYTES + 1024 * 1024, "bundle");
  if (denied) return denied;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send multipart/form-data.", field: "" }, { status: 400, headers: NO_STORE });
  }
  try {
    const consent = form.get(IDENTITY_CONSENT_FIELD);
    assertIdentityConsent(consent);
    const file = form.get("bundle");
    if (!file || typeof file === "string") return Response.json({ error: "Attach a .identity.zip.", field: "bundle" }, { status: 400, headers: NO_STORE });
    if (file.size > MAX_BUNDLE_BYTES) return Response.json({ error: "That bundle is too large.", field: "bundle" }, { status: 413, headers: NO_STORE });
    const identity = await importBundle(new Uint8Array(await file.arrayBuffer()), consent);
    return Response.json(identity, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
