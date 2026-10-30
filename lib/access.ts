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
 * Throws AccessError unless the caller holds the studio access code (when one
 * is set; in production one is required unless ALLOW_PUBLIC_SUBMIT=true).
 * Takes no rate-limit slot: use it alone for unbilled writes such as cancel,
 * so a caller who spent the last slot can still stop that job.
 */
export function assertMayControl(request: Request, accessCode: string | null): void {
  const required = process.env.STUDIO_ACCESS_CODE?.trim();
  if (required) {
    if (process.env.NODE_ENV === "production" && required.length < MIN_ACCESS_CODE_LENGTH) {
      throw new AccessError(
        503,
        "not_configured",
        `STUDIO_ACCESS_CODE must be at least ${MIN_ACCESS_CODE_LENGTH} characters; use a long random value.`,
      );
    }
    // No code at all isn't a guess, so it isn't counted.
    if (!accessCode?.trim()) {
      throw new AccessError(401, "access_code_required", "Enter the studio access code to run jobs.");
    }
    checkCredentialAttempt(limitKey(clientIp(request)), sameSecret(accessCode.trim(), required));
  } else if (process.env.NODE_ENV === "production" && process.env.ALLOW_PUBLIC_SUBMIT !== "true") {
    throw new AccessError(
      503,
      "not_configured",
      "Job submission is disabled: set STUDIO_ACCESS_CODE (or ALLOW_PUBLIC_SUBMIT=true).",
    );
  }
}

/**
 * Throws AccessError unless the caller may submit a (billed) job. Takes a
 * rate-limit slot and returns its refund: call it if Comfy never accepted
 * the job, so failed submits don't lock the caller out.
 */
export function assertMaySubmit(request: Request, accessCode: string | null): () => void {
  signingSecret(); // fail before billing a job we couldn't hand back
  assertMayControl(request, accessCode);
  return takeRateLimit(limitKey(clientIp(request)));
}

/**
 * The key a client is limited under. IPv6 is grouped by its /64, the block
 * one subscriber is given, so rotating addresses inside it can't reset a
 * limit or fill the failure tracker; an IPv4-mapped IPv6 address counts as
 * its IPv4 address. IPv4 stays per address. Anything unparseable is used as
 * given (lowercased).
 */
export function limitKey(ip: string | null): string | null {
  if (ip === null) return null;
  let address = ip.trim().toLowerCase();
  if (address.startsWith("[") && address.includes("]")) address = address.slice(1, address.indexOf("]"));
  address = address.replace(/%.*$/, ""); // zone id
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(":")) return address;
  const groups = expandIpv6(address);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : address;
}

/** The eight 16-bit groups of an IPv6 address (no embedded IPv4), or null. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ""));
}

/**
 * Takes `count` more submit slots for a request that already passed
 * assertMaySubmit (a pipeline run that plans several Comfy jobs), and returns
 * their refund. Throws AccessError 429 when the window can't hold them all.
 */
export function takeSubmitSlots(request: Request, count: number): () => void {
  if (count <= 0) return () => {};
  return takeRateLimit(clientIp(request), Date.now(), count);
}

/**
 * TRUSTED_PROXY_HOPS as a positive integer, or null when it is unset or
 * invalid (per-IP limits are then off). The one parser for this setting, so
 * the startup warning and clientIp can't disagree.
 */
export function trustedProxyHops(): number | null {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const hops = Number(raw);
  return Number.isSafeInteger(hops) && hops > 0 ? hops : null;
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
  const hops = trustedProxyHops();
  if (hops === null) return null;
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
function takeRateLimit(ip: string | null, now = Date.now(), count = 1): () => void {
  pruneHits(now);
  const check = (key: string, max: number, scope: string) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    hits.delete(key); // re-insert, so Map order tracks recency for pruneHits
    hits.set(key, recent);
    if (recent.length + count > max) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      throw new AccessError(429, "rate_limited", `Too many jobs ${scope}; try again later.`, retryAfter);
    }
  };
  if (ip !== null) check(`ip:${ip}`, limit("SUBMITS_PER_HOUR_PER_IP", 20), "from this address");
  check("global", limit("SUBMITS_PER_HOUR", 200), "on this server");
  const keys = ip !== null ? [`ip:${ip}`, "global"] : ["global"];
  for (const key of keys) for (let i = 0; i < count; i++) hits.get(key)!.push(now);
  let refunded = false;
  return () => {
    if (refunded) return;
    refunded = true;
    for (const key of keys) {
      const times = hits.get(key);
      for (let i = 0; i < count; i++) {
        const at = times?.lastIndexOf(now) ?? -1;
        if (at >= 0) times!.splice(at, 1);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Failed access codes
//
// Guessing is made impractical by the code itself: production requires at
// least MIN_ACCESS_CODE_LENGTH characters (a long random value). There is no
// global failure cap: with no trusted proxy every caller looks the same, so
// a global lockout would let anyone lock every real user out with 200 bad
// codes. With a trusted proxy (TRUSTED_PROXY_HOPS), one address that keeps
// guessing is locked out for the rest of the window, right code included,
// since letting a right code through would tell a guesser it was right.
// ---------------------------------------------------------------------------

export const MIN_ACCESS_CODE_LENGTH = 12;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const FAILURES_PER_IP = 10;

type FailureWindow = { count: number; resetAt: number };
const failures = new Map<string, FailureWindow>();

/**
 * Throws 429 if this client is locked out, else 401 (and counts a failure)
 * when the code is wrong. A right code changes nothing: failures only expire
 * with their window, so a real user's success can't reset a guesser sharing
 * the address. Synchronous end to end, so concurrent requests can't all pass
 * the check before their failures land. `ip` null (no trusted proxy): only
 * the code's strength applies.
 */
function checkCredentialAttempt(ip: string | null, correct: boolean, now: number = Date.now()): void {
  let current = ip === null ? undefined : failures.get(ip);
  if (current && current.resetAt <= now) {
    failures.delete(ip!);
    current = undefined;
  }
  if (current && current.count >= FAILURES_PER_IP) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    throw new AccessError(429, "too_many_attempts", "Too many wrong access codes; try again later.", retryAfter);
  }
  if (correct) return;
  if (ip !== null) {
    if (current) current.count += 1;
    else if (makeRoomForFailure(now)) failures.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  }
  throw new AccessError(401, "access_code_required", "That access code is wrong.");
}

/**
 * While every tracked address is locked out, nothing can be freed until the
 * earliest of their windows ends (a locked entry stays locked until then),
 * so the tracker isn't scanned again before that time.
 */
let trackerFullUntil = 0;
let trackerScans = 0;

/**
 * Frees a slot in the failure tracker if it is full, in one pass: expired
 * windows are dropped, else the oldest address that is not locked out. A
 * locked-out address is never evicted, or a guesser with many addresses
 * could flush its own lockout. Returns false when every tracked address is
 * locked out: the new address then goes untracked until a window ends. With
 * IPv6 grouped by /64 (limitKey), reaching that state takes about
 * MAX_TRACKED_IPS distinct IPv4 addresses or /64 networks.
 */
function makeRoomForFailure(now: number): boolean {
  if (failures.size < MAX_TRACKED_IPS) return true;
  if (now < trackerFullUntil) return false;
  trackerScans += 1;
  let oldestUnlocked: string | undefined;
  let earliestReset = Number.POSITIVE_INFINITY;
  for (const [key, window] of failures) {
    if (window.resetAt <= now) failures.delete(key);
    else {
      // Maps iterate in insertion order, so the first unlocked entry is the oldest.
      if (oldestUnlocked === undefined && window.count < FAILURES_PER_IP) oldestUnlocked = key;
      earliestReset = Math.min(earliestReset, window.resetAt);
    }
  }
  if (failures.size < MAX_TRACKED_IPS) return true;
  if (oldestUnlocked !== undefined) {
    failures.delete(oldestUnlocked);
    return true;
  }
  trackerFullUntil = earliestReset;
  return false;
}

/** Test hook: how many times a full tracker has been scanned. */
export function trackerScanCount(): number {
  return trackerScans;
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
  trackerFullUntil = 0;
  trackerScans = 0;
}

export function accessErrorResponse(error: AccessError): Response {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== null) headers["Retry-After"] = String(error.retryAfterSeconds);
  return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
}
