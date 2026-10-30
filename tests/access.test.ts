import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  AccessError,
  assertMaySubmit,
  clientIp,
  createJobHandle,
  readJobHandle,
  resetRateLimits,
} from "../lib/access.ts";

const env = process.env as Record<string, string | undefined>;

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/jobs", { headers });
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
  for (const name of ["STUDIO_ACCESS_CODE", "ALLOW_PUBLIC_SUBMIT", "SUBMITS_PER_HOUR_PER_IP", "SUBMITS_PER_HOUR", "TRUSTED_PROXY_HOPS"]) {
    delete env[name];
  }
  env.NODE_ENV = "test";
  env.HANDLE_SECRET = "test-secret";
});

describe("job handles", () => {
  it("round-trip without any cookie, so concurrent first submits can't strand each other", () => {
    const a = createJobHandle({ workflow: "image_resize_smoke", submittedAt: 1_700_000_000_000, jobId: "j.1" });
    const b = createJobHandle({ workflow: "image_resize_smoke", submittedAt: 1_700_000_000_001, jobId: "j-2" });
    assert.deepEqual(readJobHandle(a), { workflow: "image_resize_smoke", submittedAt: 1_700_000_000_000, jobId: "j.1" });
    assert.equal(readJobHandle(b).jobId, "j-2");
  });

  it("rejects raw ids, tampered handles and handles signed with another secret", () => {
    const handle = createJobHandle({ workflow: "image_resize_smoke", submittedAt: 1, jobId: "abc" });
    expectAccess(() => readJobHandle("abc"), 404, "job_not_found");
    expectAccess(() => readJobHandle(handle.replace(".abc.", ".abd.")), 404, "job_not_found");
    expectAccess(() => readJobHandle(handle.replace(".1.", ".0.")), 404, "job_not_found");
    env.HANDLE_SECRET = "rotated";
    expectAccess(() => readJobHandle(handle), 404, "job_not_found");
  });

  it("requires HANDLE_SECRET in production, before anything is billed", () => {
    env.NODE_ENV = "production";
    delete env.HANDLE_SECRET;
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

  it("trusts X-Forwarded-For only for the configured proxy hops", () => {
    const spoofed = request({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" });
    assert.equal(clientIp(spoofed), null, "no trusted proxies: headers are ignored");
    env.TRUSTED_PROXY_HOPS = "1";
    assert.equal(clientIp(spoofed), "198.51.100.9", "the entry our proxy appended, not the client-written one");
    env.TRUSTED_PROXY_HOPS = "2";
    assert.equal(clientIp(spoofed), "1.2.3.4");
    assert.equal(clientIp(request()), null);
  });

  it("rate-limits per trusted IP and globally; rotating spoofed headers doesn't help", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "2";
    env.SUBMITS_PER_HOUR = "3";
    env.TRUSTED_PROXY_HOPS = "1";
    const from = (spoof: string, ip: string) => request({ "x-forwarded-for": `${spoof}, ${ip}` });
    assertMaySubmit(from("9.9.9.1", "198.51.100.1"), null);
    assertMaySubmit(from("9.9.9.2", "198.51.100.1"), null);
    expectAccess(() => assertMaySubmit(from("9.9.9.3", "198.51.100.1"), null), 429, "rate_limited");
    assertMaySubmit(from("9.9.9.4", "198.51.100.2"), null);
    expectAccess(() => assertMaySubmit(from("9.9.9.5", "198.51.100.3"), null), 429, "rate_limited");
  });

  it("without trusted proxies, only the global limit applies", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "1";
    env.SUBMITS_PER_HOUR = "2";
    assertMaySubmit(request({ "x-forwarded-for": "1.1.1.1" }), null);
    assertMaySubmit(request({ "x-forwarded-for": "1.1.1.1" }), null);
    expectAccess(() => assertMaySubmit(request(), null), 429, "rate_limited");
  });
});
