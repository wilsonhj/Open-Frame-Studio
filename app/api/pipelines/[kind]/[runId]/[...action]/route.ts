/**
 * {GET,POST} /api/pipelines/{kind}/{runId}/{...path}: `cancel` plus the
 * definition's per-run actions (lib/pipeline/types.ts ActionHandler).
 */
import { NextResponse } from "next/server";

import { isPipelineKind } from "../../../../../../lib/pipeline/kinds.ts";
import { runAction } from "../../../../../../lib/pipeline/runner.ts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ kind: string; runId: string; action: string[] }> };

async function handle(method: "GET" | "POST", request: Request, { params }: Ctx) {
  const { kind, runId, action } = await params;
  if (!isPipelineKind(kind)) {
    return NextResponse.json({ error: `Unknown pipeline kind "${kind}".` }, { status: 404 });
  }
  let body: unknown = null;
  if (method === "POST") {
    const text = await request.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }
  }
  try {
    const outcome = await runAction(kind, runId, method, action, body);
    if (outcome.type === "response") return outcome.response;
    if (outcome.type === "error") return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json(outcome.run, { status: action.join("/") === "cancel" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 502 });
  }
}

export function GET(request: Request, ctx: Ctx) {
  return handle("GET", request, ctx);
}

export function POST(request: Request, ctx: Ctx) {
  return handle("POST", request, ctx);
}
