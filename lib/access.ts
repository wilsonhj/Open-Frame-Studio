/**
 * Who may submit jobs, and who may read them.
 *
 * Every job is billed to the single server-side COMFY_API_KEY, so:
 *
 *  1. Submitting needs STUDIO_ACCESS_CODE when it is set. In production it
 *     MUST be set unless ALLOW_PUBLIC_SUBMIT=true (fail closed).
 *  2. Submits are rate-limited per client IP and globally (per instance).
 *  3. The browser addresses a job only through a signed handle
 *     `<workflow>.<submittedAt>.<jobId>.<sig>` bound to an httpOnly session
 *     cookie, so a job can only be polled and downloaded by the browser that
 *     submitted it, and the server knows the job's workflow and age.
 */
import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "studio_sid";
const SID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A request the caller may not make. `status` is the HTTP status to return. */
export class AccessError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "AccessError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Session secret + cookie
// ---------------------------------------------------------------------------

let devSecret: string | null = null;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new AccessError(503, "not_configured", "SESSION_SECRET is not configured.");
  }
  // Dev only: per-process secret, so handles stop working after a restart.
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getSessionId(request: Request): string | null {
  const sid = readCookie(request, SESSION_COOKIE);
  return sid && SID_PATTERN.test(sid) ? sid : null;
}

/** The caller's session id, minting one (plus its Set-Cookie value) if absent. */
export function ensureSession(request: Request): { sid: string; setCookie: string | null } {
  const existing = getSessionId(request);
  if (existing) return { sid: existing, setCookie: null };
  const sid = randomBytes(24).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { sid, setCookie: `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` };
}

// ---------------------------------------------------------------------------
// Job handles
// ---------------------------------------------------------------------------

export type JobHandle = { workflow: string; submittedAt: number; jobId: string };

function sign(sid: string, payload: string): string {
  return createHmac("sha256", sessionSecret()).update(`${sid}\n${payload}`).digest("base64url");
}

export function createJobHandle(sid: string, handle: JobHandle): string {
  const payload = `${handle.workflow}.${handle.submittedAt}.${handle.jobId}`;
  return `${payload}.${sign(sid, payload)}`;
}

/** Verify a handle against the caller's session. Throws 404 so ids can't be probed. */
export function readJobHandle(request: Request, raw: string): JobHandle {
  const notFound = new AccessError(404, "job_not_found", "Job not found.");
  const sid = getSessionId(request);
  const parts = raw.split(".");
  if (!sid || parts.length < 4) throw notFound;
  const sig = parts.pop()!;
  const [workflow, submittedAtRaw, ...jobIdParts] = parts;
  const payload = parts.join(".");
  const expected = Buffer.from(sign(sid, payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw notFound;
  const submittedAt = Number(submittedAtRaw);
  if (!Number.isSafeInteger(submittedAt)) throw notFound;
  return { workflow, submittedAt, jobId: jobIdParts.join(".") };
}

// ---------------------------------------------------------------------------
// Submit gate: access code + rate limits
// ---------------------------------------------------------------------------

function sameSecret(a: string, b: string): boolean {
  const left = createHmac("sha256", "cmp").update(a).digest();
  const right = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Throws AccessError unless the caller may submit a (billed) job. */
export function assertMaySubmit(request: Request, accessCode: string | null): void {
  sessionSecret(); // fail before billing a job we couldn't hand back
  const required = process.env.STUDIO_ACCESS_CODE?.trim();
  if (required) {
    if (!accessCode || !sameSecret(accessCode.trim(), required)) {
      throw new AccessError(401, "access_code_required", "Enter the studio access code to run jobs.");
    }
  } else if (process.env.NODE_ENV === "production" && process.env.ALLOW_PUBLIC_SUBMIT !== "true") {
    throw new AccessError(
      503,
      "not_configured",
      "Job submission is disabled: set STUDIO_ACCESS_CODE (or ALLOW_PUBLIC_SUBMIT=true).",
    );
  }
  takeRateLimit(clientIp(request));
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

const WINDOW_MS = 60 * 60_000;
const hits = new Map<string, number[]>();

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Sliding one-hour window, in memory. Per server instance: on a multi-instance
 * host the real ceiling is limit × instances, so keep the access code on.
 */
function takeRateLimit(ip: string, now = Date.now()): void {
  const check = (key: string, max: number, scope: string) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    hits.set(key, recent);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      throw new AccessError(429, "rate_limited", `Too many jobs ${scope}; try again later.`, retryAfter);
    }
  };
  check(`ip:${ip}`, limit("SUBMITS_PER_HOUR_PER_IP", 20), "from this address");
  check("global", limit("SUBMITS_PER_HOUR", 200), "on this server");
  hits.get(`ip:${ip}`)!.push(now);
  hits.get("global")!.push(now);
}

/** Test hook. */
export function resetRateLimits(): void {
  hits.clear();
}

export function accessErrorResponse(error: AccessError): Response {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== null) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
}
