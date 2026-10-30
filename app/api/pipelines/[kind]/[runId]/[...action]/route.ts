/**
 * {GET,POST} /api/pipelines/{kind}/{runId}/{...path}: `cancel` plus the
 * definition's per-run actions (lib/pipeline/types.ts ActionHandler).
 */

import { AccessError, accessErrorResponse } from "../../../../../../lib/access.ts";
import { isPipelineKind } from "../../../../../../lib/pipeline/kinds.ts";
import { gateSubmit, gateWrite, jobCharge } from "../../../../../../lib/pipeline/gate.ts";
import { runAction } from "../../../../../../lib/pipeline/runner.ts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ kind: string; runId: string; action: string[] }> };

async function handle(method: "GET" | "POST", request: Request, { params }: Ctx) {
  const { kind, runId, action } = await params;
  if (!isPipelineKind(kind)) {
    return Response.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  // Cancel needs the access code; every other POST action (retry, regenerate)
  // can bill a job, so it also takes a rate-limit slot. GETs (export) are reads.
  let refund = () => {};
  let charge: ReturnType<typeof jobCharge> | undefined;
  if (method === "POST" && action.join("/") === "cancel") {
    const denied = gateWrite(request);
    if (denied) return denied;
  } else if (method === "POST") {
    const gate = gateSubmit(request);
    if (gate instanceof Response) return gate;
    refund = gate.refund;
    charge = jobCharge(request); // one more slot per Comfy job past the first
  }
  let body: unknown = null;
  if (method === "POST") {
    const text = await request.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      refund();
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }
  }
  try {
    const outcome = await runAction(kind, runId, method, action, body, charge);
    if (outcome.type === "response") return outcome.response;
    if (outcome.type === "error") {
      refund(); // refused (404, 409, 429, ...): nothing was replanned
      if (outcome.status === 429 && "code" in outcome) {
        return accessErrorResponse(new AccessError(429, outcome.code, outcome.error, outcome.retryAfterSeconds));
      }
      return Response.json({ error: outcome.error }, { status: outcome.status });
    }
    // A replan that submits no Comfy job gives the prepaid slot back. A create
    // still keeps its slot (that is the per-request limit); only this path
    // had already taken one for work that will not bill.
    if (outcome.releaseSlot) refund();
    return Response.json(outcome.run, { status: action.join("/") === "cancel" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    refund();
    return Response.json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 502 });
  }
}

export function GET(request: Request, ctx: Ctx) {
  return handle("GET", request, ctx);
}

export function POST(request: Request, ctx: Ctx) {
  return handle("POST", request, ctx);
}
