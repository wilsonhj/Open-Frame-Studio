import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { startMockComfy, PNG_1X1, type MockComfy } from "./mock-comfy/server.ts";

// Never send the real key anywhere from tests, and point the SDK at the mock.
const FAKE_KEY = "mock-key-not-a-secret";
let mock: MockComfy;
let comfy: typeof import("../lib/comfy.ts");

before(async () => {
  mock = await startMockComfy();
  process.env.COMFY_BASE_URL = mock.url;
  process.env.COMFY_API_KEY = FAKE_KEY;
  comfy = await import("../lib/comfy.ts");
});

after(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.setScenario("succeeded");
  mock.state.contentMode = "proxy";
  mock.state.outputContentType = "image/png";
  mock.state.gzipSigned = false;
  mock.state.jobPosts.length = 0;
  mock.state.assetPosts = 0;
  mock.state.signedFetches.length = 0;
  mock.state.cancels.length = 0;
  mock.state.cancelBehavior = "ok";
});

async function smokeWorkflow() {
  const client = comfy.createClient();
  const wf = await comfy.loadWorkflow(client, "image_resize_smoke");
  wf.setInput("1", "image", client.assets.fromBytes(new Uint8Array(PNG_1X1), { filename: "in.png", contentType: "image/png" }));
  return { client, wf };
}

describe("normalizeStatus", () => {
  it("maps API and proxy statuses onto the app's JobStatus", () => {
    assert.equal(comfy.normalizeStatus("queued"), "queued");
    assert.equal(comfy.normalizeStatus("pending"), "queued");
    assert.equal(comfy.normalizeStatus("running"), "running");
    assert.equal(comfy.normalizeStatus("canceling"), "running");
    assert.equal(comfy.normalizeStatus("succeeded"), "succeeded");
    assert.equal(comfy.normalizeStatus("failed"), "failed");
    assert.equal(comfy.normalizeStatus("cancelled"), "canceled");
    assert.equal(comfy.normalizeStatus("expired"), "expired");
    assert.equal(comfy.normalizeStatus("unknown"), "unknown");
    assert.equal(comfy.normalizeStatus("something-new"), "unknown");
    assert.equal(comfy.normalizeStatus(undefined), "unknown");
  });
});

describe("workflow loading", () => {
  it("rejects names outside the safe pattern (no path traversal)", () => {
    assert.throws(() => comfy.workflowPath("../etc/passwd"), /Invalid workflow name/);
    assert.throws(() => comfy.workflowPath("Smoke"), /Invalid workflow name/);
  });

  it("rejects UI-format exports locally", () => {
    assert.throws(() => comfy.assertApiFormat({ nodes: [], links: [], last_node_id: 1 }), /UI export/);
    assert.throws(() => comfy.assertApiFormat({ "1": { inputs: {} } }), /class_type/);
  });
});

describe("createClient", () => {
  it("requires COMFY_API_KEY when targeting Comfy Cloud", () => {
    const saved = { key: process.env.COMFY_API_KEY, base: process.env.COMFY_BASE_URL };
    try {
      delete process.env.COMFY_API_KEY;
      delete process.env.COMFY_BASE_URL;
      assert.throws(() => comfy.createClient(), comfy.ComfyNotConfiguredError);
    } finally {
      process.env.COMFY_API_KEY = saved.key;
      process.env.COMFY_BASE_URL = saved.base;
    }
  });
});

describe("submit + poll against the mock", () => {
  it("succeeded: uploads the input, submits once without metadata, polls to success, re-hosts output", async () => {
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    assert.equal(submitted.status, "queued");
    assert.equal(submitted.terminal, false);

    const updates: string[] = [];
    let running: import("../lib/types.ts").Job | undefined;
    const done = await comfy.pollJob(client, submitted.id, {
      timeoutMs: 5_000,
      intervalMs: 10,
      onUpdate: (job) => {
        updates.push(job.status);
        if (job.status === "running") running = job;
      },
    });
    assert.equal(done.status, "succeeded");
    assert.equal(done.terminal, true);
    assert.equal(done.error, null);
    assert.ok(updates.includes("running"));
    assert.deepEqual(running?.step, { current: 10, total: 20, nodeClass: "ImageScaleBy" });
    assert.equal(running?.progress, 0.5);
    assert.equal(submitted.queuePosition, 1);
    assert.equal(done.step, null);
    assert.equal(done.outputs.length, 1);
    assert.equal(done.outputs[0].nodeId, "3");
    assert.equal(done.outputs[0].url, `/api/jobs/${done.id}/outputs/${done.outputs[0].id}`);

    assert.equal(mock.state.jobPosts.length, 1);
    const post = mock.state.jobPosts[0];
    assert.ok(post.idempotencyKey, "SDK sends an Idempotency-Key");
    assert.equal("metadata" in post.body, false, "no metadata is ever sent");
    assert.equal("extra_data" in post.body, false, "no partner-node key is sent");
    const image = (post.body.workflow as Record<string, { inputs: Record<string, unknown> }>)["1"].inputs.image as {
      __type: string;
    };
    assert.equal(image.__type, "core/ASSET", "upload was substituted as a core/ASSET reference");
    assert.equal(mock.state.assetPosts, 1);
    assert.ok(mock.state.authHeaders.every((h) => h === `Bearer ${FAKE_KEY}`));

    const response = await comfy.fetchOutput(client, done.id, done.outputs[0].id);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG_1X1);
  });

  it("cloud-style output: follows the signed URL without sending the bearer token", async () => {
    mock.state.contentMode = "cloud";
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    const dir = await mkdtemp(join(tmpdir(), "oss-test-"));
    try {
      const dest = join(dir, "out.png");
      const size = await comfy.saveOutput(client, done.id, done.outputs[0].id, dest);
      assert.equal(size, PNG_1X1.length);
      assert.deepEqual(await readFile(dest), PNG_1X1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    assert.equal(mock.state.signedFetches.length, 1);
    assert.equal(mock.state.signedFetches[0].authorization, null);
  });

  it("failed: returns a terminal job carrying the node error", async () => {
    mock.setScenario("failed");
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(done.status, "failed");
    assert.equal(done.terminal, true);
    assert.equal(done.error?.code, "execution_error");
    assert.equal(done.error?.nodeId, "2");
    assert.equal(mock.state.jobPosts.length, 1);
  });

  it("expired: treated as terminal with an error", async () => {
    mock.setScenario("expired");
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(done.status, "expired");
    assert.equal(done.terminal, true);
    assert.equal(done.error?.code, "expired");
  });

  it("unknown forever: the poll deadline fires and yields terminal-with-error", async () => {
    mock.setScenario("unknown_forever");
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const started = Date.now();
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 300, intervalMs: 20 });
    const elapsed = Date.now() - started;
    assert.equal(done.status, "canceled", "adopts the state Comfy returned for the cancel");
    assert.equal(done.terminal, true);
    assert.equal(done.error?.code, "poll_timeout");
    assert.match(done.error?.message ?? "", /ended canceled/);
    assert.ok(elapsed >= 280 && elapsed < 2_000, `deadline respected (took ${elapsed} ms)`);
    assert.equal(mock.state.jobPosts.length, 1, "never resubmitted while waiting");
    assert.deepEqual(mock.state.cancels, [submitted.id], "the abandoned job is canceled so it stops billing");
  });

  it("pollJob timeout reports a failed cancel honestly", async () => {
    mock.setScenario("unknown_forever");
    mock.state.cancelBehavior = "error";
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 100, intervalMs: 20 });
    assert.equal(done.error?.code, "poll_timeout");
    assert.match(done.error?.message ?? "", /cancel failed/);
    assert.doesNotMatch(done.error?.message ?? "", /; canceled/);
  });

  it("requestCancel adopts Comfy's answer: canceled, still canceling, or failed", async () => {
    mock.setScenario("unknown_forever");
    const { client, wf } = await smokeWorkflow();
    const submit = () => comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });

    const confirmed = await comfy.requestCancel(client, (await submit()).id);
    assert.equal(confirmed.outcome, "canceled");
    assert.equal(confirmed.job?.status, "canceled");

    mock.state.cancelBehavior = "pending";
    const pending = await comfy.requestCancel(client, (await submit()).id);
    assert.equal(pending.outcome, "cancel_requested");
    assert.equal(pending.job?.terminal, false);

    mock.state.cancelBehavior = "error";
    const failed = await comfy.requestCancel(client, (await submit()).id);
    assert.equal(failed.outcome, "cancel_failed");
    assert.equal(failed.job, null);

    const shown = comfy.overdueJob({ ...pending.job!, error: null }, "cancel_failed", 15 * 60_000);
    assert.equal(shown.terminal, false, "a job whose cancel failed stays observable");
    assert.equal(shown.error?.code, "cancel_failed");
  });

  it("refuses to poll without a timeout", async () => {
    const client = comfy.createClient();
    await assert.rejects(
      // @ts-expect-error timeoutMs is required
      comfy.pollJob(client, "any-id", {}),
      TypeError,
    );
    await assert.rejects(comfy.pollJob(client, "any-id", { timeoutMs: 0 }), TypeError);
    await assert.rejects(comfy.pollJob(client, "any-id", { timeoutMs: Number.POSITIVE_INFINITY }), TypeError);
  });

  it("422 idempotency_key_reuse: surfaces SubmitRejectedError (keyReused) and does NOT resubmit", async () => {
    mock.setScenario("reject_idempotency");
    const { client, wf } = await smokeWorkflow();
    await assert.rejects(comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() }), (error: unknown) => {
      assert.ok(error instanceof comfy.SubmitRejectedError);
      assert.equal(error.code, "idempotency_key_reuse");
      assert.equal(error.httpStatus, 422);
      assert.equal(error.keyReused, true);
      return true;
    });
    assert.equal(mock.state.jobPosts.length, 1, "exactly one POST /api/v2/jobs");
  });

  it("unknown output id raises OutputNotFoundError", async () => {
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    await assert.rejects(comfy.fetchOutput(client, submitted.id, "nope"), comfy.OutputNotFoundError);
  });

  it("passes the caller's idempotency key through to the POST", async () => {
    const key = crypto.randomUUID();
    const { client, wf } = await smokeWorkflow();
    await comfy.submitOnce(client, wf, { idempotencyKey: key });
    assert.equal(mock.state.jobPosts.length, 1);
    assert.equal(mock.state.jobPosts[0].idempotencyKey, key);
  });

  it("refuses to submit without an idempotency key", async () => {
    const { client, wf } = await smokeWorkflow();
    // @ts-expect-error idempotencyKey is required
    await assert.rejects(comfy.submitOnce(client, wf, {}), TypeError);
    await assert.rejects(comfy.submitOnce(client, wf, { idempotencyKey: " " }), TypeError);
    assert.equal(mock.state.jobPosts.length, 0);
  });

  it("drop_after_create: SubmitAmbiguousError; a same-key re-send gets 422 reuse, one job exists", async () => {
    mock.setScenario("drop_after_create");
    const key = crypto.randomUUID();
    const { client, wf } = await smokeWorkflow();
    await assert.rejects(comfy.submitOnce(client, wf, { idempotencyKey: key }), (error: unknown) => {
      assert.ok(error instanceof comfy.SubmitAmbiguousError, `got ${String(error)}`);
      assert.equal(error.idempotencyKey, key);
      return true;
    });
    await assert.rejects(comfy.submitOnce(client, wf, { idempotencyKey: key }), (error: unknown) => {
      assert.ok(error instanceof comfy.SubmitRejectedError);
      assert.equal(error.keyReused, true);
      return true;
    });
    assert.equal(mock.state.jobPosts.length, 2, "two POSTs");
    assert.deepEqual(
      mock.state.jobPosts.map((p) => p.idempotencyKey),
      [key, key],
      "the re-send reused the key",
    );
    assert.equal(mock.state.jobPosts.filter((p) => p.jobId !== null).length, 1, "exactly one job created");
  });
});

describe("toSubmitError classification", () => {
  it("4xx -> SubmitRejectedError; keyReused only for idempotency_key_reuse", async () => {
    const { ComfyError } = await import("@comfyorg/sdk");
    const credits = comfy.toSubmitError(new ComfyError("no credits", { code: "insufficient_credits", httpStatus: 402 }), "k");
    assert.ok(credits instanceof comfy.SubmitRejectedError);
    assert.equal(credits.keyReused, false);
    const reuse = comfy.toSubmitError(new ComfyError("reused", { code: "idempotency_key_reuse", httpStatus: 422 }), "k");
    assert.ok(reuse instanceof comfy.SubmitRejectedError);
    assert.equal(reuse.keyReused, true);
  });

  it("5xx, status-less ComfyError and transport errors -> SubmitAmbiguousError carrying the key", async () => {
    const { ComfyError } = await import("@comfyorg/sdk");
    for (const error of [
      new ComfyError("bad gateway", { code: "internal", httpStatus: 502 }),
      new ComfyError("no response", { code: "request_timeout" }),
      new TypeError("fetch failed"),
      new DOMException("aborted", "AbortError"),
      "weird",
    ]) {
      const mapped = comfy.toSubmitError(error, "key-1");
      assert.ok(mapped instanceof comfy.SubmitAmbiguousError, `for ${String(error)}`);
      assert.equal(mapped.idempotencyKey, "key-1");
    }
  });
});

describe("outputs: filtering, safe headers, relative URLs", () => {
  it("only exposes outputs from the binding's outputNodes, under the public id", async () => {
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    const shown = comfy.withPublicId(done, "h.1.x.sig", ["3"]);
    assert.equal(shown.outputs.length, 1);
    assert.equal(shown.id, "h.1.x.sig");
    assert.match(shown.outputs[0].url, /^\/api\/jobs\/h\.1\.x\.sig\/outputs\//);
    assert.equal(comfy.withPublicId(done, "h", ["99"]).outputs.length, 0, "intermediate nodes are hidden");
    await assert.rejects(
      comfy.fetchOutput(client, submitted.id, done.outputs[0].id, { outputNodes: ["99"] }),
      comfy.OutputNotFoundError,
    );
  });

  it("serves media inline and everything else as a sandboxed attachment", () => {
    const png = comfy.outputResponseHeaders("image/png", "a.png");
    assert.equal(png.get("Content-Type"), "image/png");
    assert.match(png.get("Content-Disposition") ?? "", /^inline/);
    assert.equal(png.get("X-Content-Type-Options"), "nosniff");
    for (const risky of ["text/html", "image/svg+xml", "application/javascript", null]) {
      const headers = comfy.outputResponseHeaders(risky, "x<script>.html");
      assert.equal(headers.get("Content-Type"), "application/octet-stream", String(risky));
      assert.match(headers.get("Content-Disposition") ?? "", /^attachment; filename="x_script_.html"$/);
      assert.match(headers.get("Content-Security-Policy") ?? "", /sandbox/);
    }
  });

  it("self-hosted proxy with a path-relative download URL still re-hosts", async () => {
    mock.state.contentMode = "relative";
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    const response = await comfy.fetchOutput(client, submitted.id, done.outputs[0].id);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(PNG_1X1));
  });

  for (const contentMode of ["proxy", "cloud"] as const) {
    it(`${contentMode} output: sends the byte length when it is known`, async () => {
      mock.state.contentMode = contentMode;
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
      const response = await comfy.fetchOutput(client, submitted.id, done.outputs[0].id);
      assert.equal(response.headers.get("Content-Length"), String(PNG_1X1.length));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG_1X1);
    });
  }

  for (const type of ["text/html", "image/svg+xml"]) {
    it(`re-hosted ${type} output is a sandboxed download, never rendered on our origin`, async () => {
      mock.state.outputContentType = type;
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
      const response = await comfy.fetchOutput(client, submitted.id, done.outputs[0].id);
      assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
      assert.match(response.headers.get("Content-Disposition") ?? "", /^attachment;/);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    });
  }

  it("gzipped storage: drops the encoded Content-Length and streams every decoded byte", async () => {
    mock.state.contentMode = "cloud";
    mock.state.gzipSigned = true;
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    const response = await comfy.fetchOutput(client, submitted.id, done.outputs[0].id);
    assert.equal(response.headers.get("Content-Length"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG_1X1);
  });

  it("rehosts outputs with safe headers", async () => {
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    const response = await comfy.fetchOutput(client, submitted.id, done.outputs[0].id);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  });
});

describe("POST /api/jobs", () => {
  async function post(fields: Record<string, string | File>) {
    const dataDir = await mkdtemp(join(tmpdir(), "oss-jobs-"));
    process.env.DATA_DIR = dataDir;
    try {
      const { POST } = await import("../app/api/jobs/route.ts");
      const body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.set(name, value);
      const response = await POST(new Request("http://127.0.0.1/api/jobs", { method: "POST", body }));
      return { status: response.status, job: (await response.json()) as import("../lib/types.ts").SubmittedJob };
    } finally {
      delete process.env.DATA_DIR;
      await rm(dataDir, { recursive: true, force: true });
    }
  }

  it("202 with the queued job, its queue position and no seeds for a seedless workflow", async () => {
    const image = new File([new Uint8Array(PNG_1X1)], "in.png", { type: "image/png" });
    const { status, job } = await post({ workflow: "image_resize_smoke", image });
    assert.equal(status, 202);
    assert.equal(job.status, "queued");
    assert.equal(job.queuePosition, 1);
    assert.deepEqual(job.seeds, {});
  });

  const submittedSeed = () =>
    (mock.state.jobPosts.at(-1)!.body.workflow as Record<string, { inputs: Record<string, unknown> }>).p70.inputs.noise_seed;

  it("returns the random seed it ran with, matching the submitted graph", async () => {
    const random = await post({ workflow: "klein_t2i", prompt: "a lamp" });
    assert.equal(random.status, 202);
    assert.ok(Number.isSafeInteger(random.job.seeds.seed));
    assert.equal(submittedSeed(), random.job.seeds.seed, "echoed seed is the one in the graph");
  });

  it("submits a supplied seed unchanged, including 0", async () => {
    for (const seed of [1234, 0]) {
      const locked = await post({ workflow: "klein_t2i", prompt: "a lamp", seed: String(seed) });
      assert.deepEqual(locked.job.seeds, { seed });
      assert.equal(submittedSeed(), seed);
    }
  });

  it("polling never regenerates or re-reports seeds", async () => {
    const { job } = await post({ workflow: "klein_t2i", prompt: "a lamp" });
    const posts = mock.state.jobPosts.length;
    const { GET } = await import("../app/api/jobs/[id]/route.ts");
    for (let i = 0; i < 3; i += 1) {
      const response = await GET(new Request(`http://127.0.0.1/api/jobs/${job.id}`), { params: Promise.resolve({ id: job.id }) });
      assert.equal(response.status, 200);
      assert.equal("seeds" in (await response.json()), false);
    }
    assert.equal(mock.state.jobPosts.length, posts, "no resubmit");
  });
});

describe("rejected submit mapping", () => {
  it("maps account problems to 503, keeps 402/429, else 422", () => {
    assert.equal(comfy.rejectedSubmitStatus(401), 503);
    assert.equal(comfy.rejectedSubmitStatus(403), 503);
    assert.equal(comfy.rejectedSubmitStatus(402), 402);
    assert.equal(comfy.rejectedSubmitStatus(429), 429);
    assert.equal(comfy.rejectedSubmitStatus(422), 422);
    assert.equal(comfy.rejectedSubmitStatus(400), 422);
    const forbidden = new comfy.SubmitRejectedError("free tier", "forbidden", 403, null);
    assert.match(comfy.rejectedSubmitMessage(forbidden), /plan/);
  });
});
