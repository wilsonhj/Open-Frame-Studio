import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  AccessError,
  assertMaySubmit,
  clientIp,
  createJobHandle,
  readJobHandle,
  resetCredentialFailures,
  resetRateLimits,
  trackedRateLimitKeys,
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
    const a = createJobHandle({ binding: "image_resize_smoke", submittedAt: 1_700_000_000_000, jobId: "j.1" });
    const b = createJobHandle({ binding: "image_resize_smoke", submittedAt: 1_700_000_000_001, jobId: "j-2" });
    assert.deepEqual(readJobHandle(a), { binding: "image_resize_smoke", submittedAt: 1_700_000_000_000, jobId: "j.1" });
    assert.equal(readJobHandle(b).jobId, "j-2");
  });

  it("rejects raw ids, tampered handles and handles signed with another secret", () => {
    const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt: 1, jobId: "abc" });
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

  it("refunding a slot for a submit Comfy never accepted frees it, once", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "1";
    env.SUBMITS_PER_HOUR = "5";
    env.TRUSTED_PROXY_HOPS = "1";
    const from = () => request({ "x-forwarded-for": "198.51.100.7" });
    const refund = assertMaySubmit(from(), null);
    expectAccess(() => assertMaySubmit(from(), null), 429, "rate_limited");
    refund();
    refund(); // idempotent: must not free a second, still-used slot
    assertMaySubmit(from(), null);
    expectAccess(() => assertMaySubmit(from(), null), 429, "rate_limited");
  });

  it("drops quiet addresses so the limiter's memory stays bounded", () => {
    env.SUBMITS_PER_HOUR = "100000";
    env.TRUSTED_PROXY_HOPS = "1";
    for (let i = 0; i < 10_050; i++) {
      assertMaySubmit(request({ "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` }), null);
    }
    assert.ok(trackedRateLimitKeys() <= 10_001, `tracked ${trackedRateLimitKeys()} keys`);
  });

  it("without trusted proxies, only the global limit applies", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "1";
    env.SUBMITS_PER_HOUR = "2";
    assertMaySubmit(request({ "x-forwarded-for": "1.1.1.1" }), null);
    assertMaySubmit(request({ "x-forwarded-for": "1.1.1.1" }), null);
    expectAccess(() => assertMaySubmit(request(), null), 429, "rate_limited");
  });
});

describe("failed access codes", () => {
  const from = (ip: string) => request({ "x-forwarded-for": ip });

  beforeEach(() => {
    env.STUDIO_ACCESS_CODE = "open-sesame";
    env.TRUSTED_PROXY_HOPS = "1";
  });

  it("locks out a client after 10 wrong codes, even for the right code, with Retry-After", () => {
    for (let i = 0; i < 10; i += 1) expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 401, "access_code_required");
    for (let i = 0; i < 1_000; i += 1) {
      expectAccess(() => assertMaySubmit(from("1.2.3.4"), `guess-${i}`), 429, "too_many_attempts");
    }
    assert.throws(
      () => assertMaySubmit(from("1.2.3.4"), "open-sesame"),
      (error: unknown) => error instanceof AccessError && error.status === 429 && error.retryAfterSeconds! > 0,
    );
    assertMaySubmit(from("5.6.7.8"), "open-sesame"); // other clients are unaffected
  });

  it("a right code doesn't reset a shared address's failures; a missing code isn't counted", () => {
    for (let i = 0; i < 9; i += 1) expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 401, "access_code_required");
    for (let i = 0; i < 50; i += 1) expectAccess(() => assertMaySubmit(from("1.2.3.4"), null), 401, "access_code_required");
    assertMaySubmit(from("1.2.3.4"), "open-sesame"); // a real user behind the same NAT
    expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 401, "access_code_required"); // 10th failure
    expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 429, "too_many_attempts");
  });

  it("other people's wrong codes never lock out the right code (no global lockout)", () => {
    delete env.TRUSTED_PROXY_HOPS; // every caller looks the same
    for (let i = 0; i < 1_000; i += 1) expectAccess(() => assertMaySubmit(from(`10.0.${i >> 8}.${i & 255}`), "wrong"), 401, "access_code_required");
    assertMaySubmit(from("10.9.9.9"), "open-sesame");
    env.TRUSTED_PROXY_HOPS = "1";
    for (let i = 0; i < 300; i += 1) expectAccess(() => assertMaySubmit(from(`10.1.${i >> 8}.${i & 255}`), "wrong"), 401, "access_code_required");
    assertMaySubmit(from("10.9.9.9"), "open-sesame");
  });

  it("requires a long access code in production", () => {
    env.NODE_ENV = "production";
    env.STUDIO_ACCESS_CODE = "short";
    expectAccess(() => assertMaySubmit(from("1.2.3.4"), "short"), 503, "not_configured");
    env.STUDIO_ACCESS_CODE = "a-long-random-access-code";
    assertMaySubmit(from("1.2.3.4"), "a-long-random-access-code");
  });

  it("wrong codes and lockouts never consume paid-submit quota", () => {
    env.SUBMITS_PER_HOUR_PER_IP = "3";
    for (let i = 0; i < 10; i += 1) expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 401, "access_code_required");
    for (let i = 0; i < 5; i += 1) expectAccess(() => assertMaySubmit(from("1.2.3.4"), "wrong"), 429, "too_many_attempts");
    // A separate limiter: the same client's quota is untouched, so after its
    // lockout window it still gets all 3 submits.
    resetCredentialFailures();
    for (let i = 0; i < 3; i += 1) assertMaySubmit(from("1.2.3.4"), "open-sesame");
    expectAccess(() => assertMaySubmit(from("1.2.3.4"), "open-sesame"), 429, "rate_limited");
  });

  it("concurrent wrong submits can't all slip past the check before failures are recorded", async () => {
    const { POST } = await import("../app/api/jobs/route.ts");
    const submit = () => {
      const body = new FormData();
      body.set("workflow", "image_resize_smoke");
      body.set("access_code", "wrong");
      return POST(new Request("http://localhost/api/jobs", { method: "POST", body, headers: { "x-forwarded-for": "1.2.3.4" } }));
    };
    const statuses = (await Promise.all(Array.from({ length: 50 }, submit))).map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 401).length, 10);
    assert.equal(statuses.filter((status) => status === 429).length, 40);
  });
});
