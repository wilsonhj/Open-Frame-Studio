/**
 * Access policy for the pipeline routes, the same as /api/jobs (lib/access.ts):
 * anything that can bill a Comfy job needs the studio access code (when one is
 * set) and takes a rate-limit slot. Reads need no code: a run id is a random
 * server-minted UUID, so it is itself the capability (as a signed job handle
 * is for /api/jobs).
 */
import { AccessError, accessErrorResponse, assertMaySubmit } from "../access.ts";

/** Header the studio client sends the access code in (JSON and multipart alike). */
export const ACCESS_CODE_HEADER = "x-access-code";

/** A billed request: returns the slot refund, or the error response to send. */
export function gateSubmit(request: Request, formCode: string | null = null): { refund: () => void } | Response {
  try {
    return { refund: assertMaySubmit(request, request.headers.get(ACCESS_CODE_HEADER) ?? formCode) };
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    throw error;
  }
}

/** An unbilled write (cancel): the same code check, without keeping a slot. */
export function gateWrite(request: Request): Response | null {
  const gate = gateSubmit(request);
  if (gate instanceof Response) return gate;
  gate.refund();
  return null;
}
