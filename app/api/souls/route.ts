/**
 * GET  /api/souls  → `{ identities: Identity[] }` (needs the access code when one is set: faces).
 * POST /api/souls  multipart: `name`, `consent` ("true"), `photos` (1–20 files),
 *                  optional `styleCard` (JSON) → 201 `{ identity, photos, advisories }`,
 *                  or 422 `{ error, photos, advisories }` when fewer than 3 photos pass.
 *
 * Photo QA, cropping and selection run here, on CPU, with no Comfy call: the
 * original photos never leave this server and are not written to disk
 * (docs/spec/identity.md §4, §5, §8). Not billed, so no rate-limit slot.
 */
import { gateWrite } from "../../../lib/pipeline/gate.ts";
import { errorResponse, NO_STORE } from "../../../lib/identity/http.ts";
import { intakeIdentity } from "../../../lib/identity/intake.ts";
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "../../../lib/identity/qa.ts";
import { refuseBody } from "../../../lib/identity/body.ts";
import { assertIdentityConsent, IDENTITY_CONSENT_FIELD } from "../../../lib/identity/consent.ts";
import { listSouls } from "../../../lib/soul/registry.ts";
import type { StyleCard } from "../../../lib/types.ts";

export const runtime = "nodejs";

/** 20 photos of at most 25 MB, plus form framing. */
export const MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 1024 * 1024;

export async function GET(request: Request) {
  const denied = gateWrite(request);
  if (denied) return denied;
  try {
    return Response.json({ identities: await listSouls() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const denied = gateWrite(request) ?? refuseBody(request, MAX_BODY_BYTES, "photos");
  if (denied) return denied;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send multipart/form-data.", field: "" }, { status: 400, headers: NO_STORE });
  }
  try {
    // Consent before any photo is read (intakeIdentity checks it again).
    const consent = form.get(IDENTITY_CONSENT_FIELD);
    assertIdentityConsent(consent);
    const files = form.getAll("photos").filter((v): v is File => typeof v !== "string").slice(0, MAX_PHOTOS + 1);
    const big = files.findIndex((file) => file.size > MAX_PHOTO_BYTES);
    if (big >= 0) {
      return Response.json({ error: `Photo ${big + 1} is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`, field: "photos" }, { status: 413, headers: NO_STORE });
    }
    const photos: Uint8Array[] = [];
    for (const file of files) photos.push(new Uint8Array(await file.arrayBuffer()));
    let styleCard: Partial<StyleCard> | undefined;
    const card = form.get("styleCard");
    if (typeof card === "string" && card.trim()) {
      try {
        styleCard = JSON.parse(card) as Partial<StyleCard>;
      } catch {
        return Response.json({ error: "styleCard must be JSON.", field: "styleCard" }, { status: 400, headers: NO_STORE });
      }
    }
    const result = await intakeIdentity({ name: form.get("name"), consent, photos, styleCard });
    if (!result.ok) return Response.json(result, { status: 422, headers: NO_STORE });
    return Response.json(result, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

