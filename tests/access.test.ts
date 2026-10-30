import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  AccessError,
  SESSION_COOKIE,
  assertMaySubmit,
  createJobHandle,
  ensureSession,
  readJobHandle,
  resetRateLimits,
} from "../lib/access.ts";

const env = process.env as Record<string, string | undefined>;

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/jobs", { headers });
}

function withCookie(sid: string, ip = "203.0.113.7") {
  return request({ cookie: `other=1; ${SESSION_COOKIE}=${sid}`, "x-forwarded-for": `${ip}, 10.0.0.1` });
}

function expectAccess(fn: () => unknown, status: number, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof AccessError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

beforeEach(() => {
  resetRateLimits();
  delete env.STUDIO_ACCESS_CODE;
  delete env.ALLOW_PUBLIC_SUBMIT;
  delete env.SUBMITS_PER_HOUR_PER_IP;
  delete env.SUBMITS_PER_HOUR;
  env.NODE_ENV = "test";
  env.SESSION_SECRET = "test-secret";
});

describe("job handles", () => {
  it("round-trips for the submitting session only", () => {
    const { sid, setCookie } = ensureSession(request());
    assert.match(setCookie ?? "", /HttpOnly/);
    const handle = createJobHandle(sid, { workflow: "image_resize_smoke", submittedAt: 1_700_000_000_000, jobId: "j.1" });
    assert.deepEqual(readJobHandle(withCookie(sid), handle), {
      workflow: "image_resize_smoke",
      submittedAt: 1_700_000_000_000,
      jobId: "j.1",
    });
    const other = ensureSession(request()).sid;
    expectAccess(() => readJobHandle(withCookie(other), handle), 404, "job_not_found");
    expectAccess(() => readJobHandle(request(), handle), 404, "job_not_found");
  });

  it("rejects raw ids and tampered handles", () => {
    const { sid } = ensureSession(request());
    const handle = createJobHandle(sid, { workflow: "image_resize_smoke", submittedAt: 1, jobId: "abc" });
    expectAccess(() => readJobHandle(withCookie(sid), "abc"), 404, "job_not_found");
    expectAccess(() => readJobHandle(withCookie(sid), handle.replace(".abc.", ".abd.")), 404, "job_not_found");
    expectAccess(() => readJobHandle(withCookie(sid), handle.replace(".1.", ".0.")), 404, "job_not_found");
  });

  it("requires SESSION_SECRET in production", () => {
    env.NODE_ENV = "production";
    delete env.SESSION_SECRET;
    env.STUDIO_ACCESS_CODE = "code";
    expectAccess(() => assertMaySubmit(request(), "code"), 503, "not_configured");
  });
});

describe("submit gate", () => {
  it("requires the access code when one is set", () => {
    env.STUDIO_ACCESS_CODE = "open-sesame";
    expectAccess(() => assertMaySubmit(request(), null), 401, "access_code_required");
    expectAccess(() => assertMaySubmit(request(), "wrong"), 401, "access_code_required");
    assertMaySubmit(request(), " open-sesame ");
  });

  it("fails closed in production without an access code", () => {
    env.NODE_ENV = "production";
    expectAccess(() => assertMaySubmit(request(), null), 503, "not_configured");
    env.ALLOW_PUBLIC_SUBMIT = "true";
    assertMaySubmit(request(), null);
  });

  it("rate-limits per IP and globally", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "2";
    env.SUBMITS_PER_HOUR = "3";
    const from = (ip: string) => request({ "x-forwarded-for": ip });
    assertMaySubmit(from("198.51.100.1"), null);
    assertMaySubmit(from("198.51.100.1"), null);
    expectAccess(() => assertMaySubmit(from("198.51.100.1"), null), 429, "rate_limited");
    assertMaySubmit(from("198.51.100.2"), null);
    expectAccess(() => assertMaySubmit(from("198.51.100.3"), null), 429, "rate_limited");
  });
});
