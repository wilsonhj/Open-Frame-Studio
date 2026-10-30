/**
 * Who may submit jobs, and who may read them.
 *
 * Every job is billed to the single server-side COMFY_API_KEY, so:
 *
 *  1. Submitting needs STUDIO_ACCESS_CODE when it is set. In production it
 *     MUST be set unless ALLOW_PUBLIC_SUBMIT=true (fail closed).
 *  2. Submits are rate-limited per client IP and globally (per instance).
 *     Forwarding headers are trusted only for TRUSTED_PROXY_HOPS proxies.
 *  3. The browser addresses a job only through a signed, unguessable handle
 *     `<workflow>.<submittedAt>.<jobId>.<sig>`: a capability, like a share
 *     link. Whoever holds it can poll and download that job; nobody can
 *     forge one for another job. It carries no cookie, so concurrent tabs
 *     can't overwrite each other's ownership.
 */
import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
// Signing secret
// ---------------------------------------------------------------------------

let devSecret: string | null = null;

function signingSecret(): string {
  const secret = process.env.HANDLE_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new AccessError(503, "not_configured", "HANDLE_SECRET is not configured.");
  }
  // Dev only: per-process secret, so handles stop working after a restart.
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

// ---------------------------------------------------------------------------
// Job handles
// ---------------------------------------------------------------------------

export type JobHandle = { workflow: string; submittedAt: number; jobId: string };

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(`job-handle\n${payload}`).digest("base64url");
}

export function createJobHandle(handle: JobHandle): string {
  const payload = `${handle.workflow}.${handle.submittedAt}.${handle.jobId}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify a handle. Throws 404 for anything unsigned or tampered, so ids can't be probed. */
export function readJobHandle(raw: string): JobHandle {
  const notFound = new AccessError(404, "job_not_found", "Job not found.");
  const parts = raw.split(".");
  if (parts.length < 4) throw notFound;
  const sig = parts.pop()!;
  const [workflow, submittedAtRaw, ...jobIdParts] = parts;
  const expected = Buffer.from(sign(parts.join(".")));
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
  signingSecret(); // fail before billing a job we couldn't hand back
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

/**
 * The client address for per-IP limits. `X-Forwarded-For` is client-writable
 * except for the entries our own proxies append, so with N trusted proxies
 * (TRUSTED_PROXY_HOPS, e.g. 1 on Vercel or behind one nginx) the client is
 * the Nth entry from the right. With no trusted proxies (the default) no
 * header is believed and there is no per-IP limit; the global limit and the
 * access code still apply.
 */
export function clientIp(request: Request): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return chain.length >= hops ? chain[chain.length - hops] : null;
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
function takeRateLimit(ip: string | null, now = Date.now()): void {
  const check = (key: string, max: number, scope: string) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    hits.set(key, recent);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      throw new AccessError(429, "rate_limited", `Too many jobs ${scope}; try again later.`, retryAfter);
    }
  };
  if (ip !== null) check(`ip:${ip}`, limit("SUBMITS_PER_HOUR_PER_IP", 20), "from this address");
  check("global", limit("SUBMITS_PER_HOUR", 200), "on this server");
  if (ip !== null) hits.get(`ip:${ip}`)!.push(now);
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
