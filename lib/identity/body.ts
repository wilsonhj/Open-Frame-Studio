/** Body-size guard for the /api/souls multipart routes (slice C). Server-only. */
import "server-only";

import { NO_STORE } from "./http.ts";

/**
 * Refuse a body by its declared length before `formData()` buffers it: no
 * Content-Length (a chunked upload of unknown size) is 411, over `max` is 413.
 * Node checks the body against the declared length, so the cap holds.
 */
export function refuseBody(request: Request, max: number, field: string): Response | null {
  const raw = request.headers.get("content-length");
  const length = raw !== null && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(length)) {
    return Response.json({ error: "Send the upload with a Content-Length.", field }, { status: 411, headers: NO_STORE });
  }
  if (length > max) return Response.json({ error: "Too much to upload at once.", field }, { status: 413, headers: NO_STORE });
  return null;
}
