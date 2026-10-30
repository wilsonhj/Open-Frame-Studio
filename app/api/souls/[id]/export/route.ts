/**
 * GET /api/souls/{id}/export: the portable `.identity.zip` (identity.json with
 * refs by path, plus refs/ref_N.png; no asset ids, URLs or original photos).
 * Needs the access code when one is set, like the list (the client downloads
 * it with fetch, sending the X-Access-Code header).
 */
import { errorResponse } from "../../../../../lib/identity/http.ts";
import { gateWrite } from "../../../../../lib/pipeline/gate.ts";
import { exportBundle } from "../../../../../lib/soul/registry.ts";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = gateWrite(request);
  if (denied) return denied;
  try {
    const { filename, bytes } = await exportBundle((await params).id);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
