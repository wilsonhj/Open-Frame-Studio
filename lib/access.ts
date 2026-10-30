/**
 * Who may submit jobs, and who may read them.
 *
 * Every job is billed to the single server-side COMFY_API_KEY, so:
 *
 *  1. Submitting needs STUDIO_ACCESS_CODE when it is set. In production it
 *     MUST be set unless ALLOW_PUBLIC_SUBMIT=true (fail closed).
 *  2. Submits are rate-limited per client IP and globally (per instance).
 *     Forwarding headers are trusted only for TRUSTED_PROXY_HOPS proxies.
 *     Wrong access codes are limited separately and more tightly, so the
 *     code can't be guessed online.
 *  3. The browser addresses a job only through a signed, unguessable handle
 *     `<binding>.<submittedAt>.<jobId>.<sig>`: a capability, like a share
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

/** `binding` is the registry name (lib/bindings), not the workflow file it loads. */
export type JobHandle = { binding: string; submittedAt: number; jobId: string };

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(`job-handle\n${payload}`).digest("base64url");
}

export function createJobHandle(handle: JobHandle): string {
  const payload = `${handle.binding}.${handle.submittedAt}.${handle.jobId}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify a handle. Throws 404 for anything unsigned or tampered, so ids can't be probed. */
export function readJobHandle(raw: string): JobHandle {
  const notFound = new AccessError(404, "job_not_found", "Job not found.");
  const parts = raw.split(".");
  if (parts.length < 4) throw notFound;
  const sig = parts.pop()!;
  const [binding, submittedAtRaw, ...jobIdParts] = parts;
  const expected = Buffer.from(sign(parts.join(".")));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw notFound;
  const submittedAt = Number(submittedAtRaw);
  if (!Number.isSafeInteger(submittedAt)) throw notFound;
  return { binding, submittedAt, jobId: jobIdParts.join(".") };
}

// ---------------------------------------------------------------------------
// Submit gate: access code + rate limits
// ---------------------------------------------------------------------------

function sameSecret(a: string, b: string): boolean {
  const left = createHmac("sha256", "cmp").update(a).digest();
  const right = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Throws AccessError unless the caller may submit a (billed) job. Takes a
 * rate-limit slot and returns its refund: call it if Comfy never accepted
 * the job, so failed submits don't lock the caller out.
 */
export function assertMaySubmit(request: Request, accessCode: string | null): () => void {
  signingSecret(); // fail before billing a job we couldn't hand back
  const required = process.env.STUDIO_ACCESS_CODE?.trim();
  if (required) {
    // No code at all isn't a guess, so it isn't counted.
    if (!accessCode?.trim()) {
      throw new AccessError(401, "access_code_required", "Enter the studio access code to run jobs.");
    }
    const ip = clientIp(request);
    takeCredentialAttempt(ip);
    if (!sameSecret(accessCode.trim(), required)) {
      throw new AccessError(401, "access_code_required", "That access code is wrong.");
    }
    refundCredentialAttempt(ip);
  } else if (process.env.NODE_ENV === "production" && process.env.ALLOW_PUBLIC_SUBMIT !== "true") {
    throw new AccessError(
      503,
      "not_configured",
      "Job submission is disabled: set STUDIO_ACCESS_CODE (or ALLOW_PUBLIC_SUBMIT=true).",
    );
  }
  return takeRateLimit(clientIp(request));
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
/** Distinct addresses kept; past this the least recently seen are dropped. */
const MAX_TRACKED_IPS = 10_000;
const PRUNE_EVERY_MS = 60_000;
const hits = new Map<string, number[]>();
let lastPruneAt = 0;

/** Drop windows that have emptied, then cap the address count, so the map can't grow without bound. */
function pruneHits(now: number): void {
  if (now - lastPruneAt < PRUNE_EVERY_MS && hits.size <= MAX_TRACKED_IPS) return;
  lastPruneAt = now;
  for (const [key, times] of hits) {
    const recent = times.filter((at) => now - at < WINDOW_MS);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
  for (const key of hits.keys()) {
    if (hits.size <= MAX_TRACKED_IPS) break;
    if (key !== "global") hits.delete(key); // Map order: least recently refreshed first
  }
}

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Sliding one-hour window, in memory. Per server instance: on a multi-instance
 * host the real ceiling is limit × instances, so keep the access code on.
 */
function takeRateLimit(ip: string | null, now = Date.now()): () => void {
  pruneHits(now);
  const check = (key: string, max: number, scope: string) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    hits.delete(key); // re-insert, so Map order tracks recency for pruneHits
    hits.set(key, recent);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      throw new AccessError(429, "rate_limited", `Too many jobs ${scope}; try again later.`, retryAfter);
    }
  };
  if (ip !== null) check(`ip:${ip}`, limit("SUBMITS_PER_HOUR_PER_IP", 20), "from this address");
  check("global", limit("SUBMITS_PER_HOUR", 200), "on this server");
  const keys = ip !== null ? [`ip:${ip}`, "global"] : ["global"];
  for (const key of keys) hits.get(key)!.push(now);
  let refunded = false;
  return () => {
    if (refunded) return;
    refunded = true;
    for (const key of keys) {
      const times = hits.get(key);
      const at = times?.lastIndexOf(now) ?? -1;
      if (at >= 0) times!.splice(at, 1);
    }
  };
}

// ---------------------------------------------------------------------------
// Failed access codes
// ---------------------------------------------------------------------------

const ATTEMPT_WINDOW_MS = 15 * 60_000;
const FAILURES_PER_IP = 10;
/** Caps guessing spread across many addresses (or with no trusted proxy, all of it). */
const FAILURES_TOTAL = 200;

type FailureWindow = { count: number; resetAt: number };
const failures = new Map<string, FailureWindow>();
let failuresTotal: FailureWindow = { count: 0, resetAt: 0 };

/**
 * Takes one access-code attempt for this client, counted as a failure up
 * front; throws 429 when it (or everyone) is over the limit. Check and count
 * are one synchronous step, so concurrent requests can't all pass the check
 * before the first failure lands. Call refundCredentialAttempt once the code
 * turns out right. `ip` null (no trusted proxy): only the global cap applies.
 */
export function takeCredentialAttempt(ip: string | null, now: number = Date.now()): void {
  if (failuresTotal.resetAt <= now) failuresTotal = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
  let current = ip === null ? undefined : failures.get(ip);
  if (current && current.resetAt <= now) {
    failures.delete(ip!);
    current = undefined;
  }
  const blockedUntil = Math.max(
    current && current.count >= FAILURES_PER_IP ? current.resetAt : 0,
    failuresTotal.count >= FAILURES_TOTAL ? failuresTotal.resetAt : 0,
  );
  if (blockedUntil) {
    const retryAfter = Math.ceil((blockedUntil - now) / 1000);
    throw new AccessError(429, "too_many_attempts", "Too many wrong access codes; try again later.", retryAfter);
  }
  failuresTotal.count += 1;
  if (ip === null) return;
  if (current) {
    current.count += 1;
    return;
  }
  if (failures.size >= MAX_TRACKED_IPS) {
    for (const [key, window] of failures) if (window.resetAt <= now) failures.delete(key);
    // Still full: drop the oldest entry (Maps iterate in insertion order).
    if (failures.size >= MAX_TRACKED_IPS) failures.delete(failures.keys().next().value!);
  }
  failures.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
}

/** The code was right: un-count the attempt and clear this client's earlier failures. */
export function refundCredentialAttempt(ip: string | null): void {
  if (ip !== null) failures.delete(ip);
  if (failuresTotal.count > 0) failuresTotal.count -= 1;
}

/** Test hook. */
export function trackedRateLimitKeys(): number {
  return hits.size;
}

/** Test hook. */
export function resetRateLimits(): void {
  hits.clear();
  lastPruneAt = 0;
  resetCredentialFailures();
}

/** Test hook: forget failed codes only (as when their window ends), leaving submit quota as is. */
export function resetCredentialFailures(): void {
  failures.clear();
  failuresTotal = { count: 0, resetAt: 0 };
}

export function accessErrorResponse(error: AccessError): Response {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== null) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
}
