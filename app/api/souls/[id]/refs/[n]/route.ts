/**
 * GET /api/souls/{id}/refs/{n}: the PNG of reference crop `n` (for thumbnails).
 * Needs the access code when one is set, like the list: the client fetches
 * thumbnails with the X-Access-Code header and shows them as blob URLs.
 */
import { outputResponseHeaders } from "../../../../../../lib/comfy.ts";
import { gateWrite } from "../../../../../../lib/pipeline/gate.ts";
import { readRefPng } from "../../../../../../lib/soul/registry.ts";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const denied = gateWrite(request);
  if (denied) return denied;
  const { id, n } = await params;
  const bytes = /^\d$/.test(n) ? await readRefPng(id, Number(n)).catch(() => null) : null;
  if (!bytes) return Response.json({ error: "Not found." }, { status: 404 });
  const headers = outputResponseHeaders("image/png", `ref_${n}.png`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}
