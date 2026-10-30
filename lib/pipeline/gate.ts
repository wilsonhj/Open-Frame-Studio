/**
 * Access policy for the pipeline routes, the same as /api/jobs (lib/access.ts):
 * anything that can bill a Comfy job needs the studio access code (when one is
 * set) and takes a rate-limit slot. Reads need no code: a run id is a random
 * server-minted UUID, so it is itself the capability (as a signed job handle
 * is for /api/jobs).
 */
import { AccessError, accessErrorResponse, assertMayControl, assertMaySubmit } from "../access.ts";

/** Header the studio client sends the access code in (JSON and multipart alike). */
export const ACCESS_CODE_HEADER = "x-access-code";

/**
 * A billed request: returns the slot refund, or the error response to send.
 * The code comes from the header only, so routes can check it before reading
 * the body.
 */
export function gateSubmit(request: Request): { refund: () => void } | Response {
  try {
    return { refund: assertMaySubmit(request, request.headers.get(ACCESS_CODE_HEADER)) };
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    throw error;
  }
}

/**
 * An unbilled write (cancel): the same access-code check, but no rate-limit
 * slot, so a caller at quota can still stop the job that used their last one.
 */
export function gateWrite(request: Request): Response | null {
  try {
    assertMayControl(request, request.headers.get(ACCESS_CODE_HEADER));
    return null;
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    throw error;
  }
}
