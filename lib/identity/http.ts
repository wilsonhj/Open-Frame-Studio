/** Shared bits of the /api/souls routes (slice C). Server-only. */
import "server-only";

import { AccessError, accessErrorResponse } from "../access.ts";
import { InputError } from "../inputs.ts";
import { FaceModelUnavailableError } from "./detector.ts";
import { IdentityInputError, SoulNotFoundError } from "../soul/registry.ts";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Map known errors to JSON responses; anything else is a 500 without details. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AccessError) return accessErrorResponse(error);
  if (error instanceof SoulNotFoundError) return Response.json({ error: "Identity not found." }, { status: 404, headers: NO_STORE });
  if (error instanceof IdentityInputError) return Response.json({ error: error.message, field: error.field }, { status: 400, headers: NO_STORE });
  if (error instanceof InputError) return Response.json({ error: error.message, field: error.field }, { status: 400, headers: NO_STORE });
  if (error instanceof FaceModelUnavailableError) {
    console.error(`[identity] ${error.message}`);
    return Response.json({ error: "Photo checks are unavailable on this server right now." }, { status: 503, headers: NO_STORE });
  }
  // Never log names, file names or URLs (§8.5): the error class only.
  console.error(`[identity] ${error instanceof Error ? error.name : "error"}`);
  return Response.json({ error: "Something went wrong with that identity." }, { status: 500, headers: NO_STORE });
}
