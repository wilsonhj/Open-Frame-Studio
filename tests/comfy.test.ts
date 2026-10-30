import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  mock.state.videoOutputType = "video";
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
  it("a video Comfy Cloud labels 'image' is exposed as video; real images stay images", async () => {
    mock.setScenario("multi_output");
    mock.state.videoOutputType = "image"; // what Cloud reports for an MP4 (content type video/mp4)
    const { client, wf } = await smokeWorkflow();
    const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
    const done = await comfy.pollJob(client, submitted.id, { timeoutMs: 5_000, intervalMs: 10 });
    assert.deepEqual(
      done.outputs.map((o) => [o.type, o.contentType, o.nodeId]),
      [
        ["image", "image/png", "9"],
        ["image", "image/png", "9"],
        ["video", "video/mp4", "12"],
      ],
    );
  });

  it("derives the output type from the filename or content type only for outputs labelled image", () => {
    assert.equal(comfy.outputType("image", "H3_00001_.mp4", "application/octet-stream"), "video");
    assert.equal(comfy.outputType("image", "clip.WEBM", ""), "video");
    assert.equal(comfy.outputType("image", "clip.mov", "video/quicktime"), "video");
    assert.equal(comfy.outputType("image", "noext", "video/mp4"), "video");
    assert.equal(comfy.outputType("image", "voice_00001_.wav", "audio/wav"), "audio");
    assert.equal(comfy.outputType("image", "song.mp3", ""), "audio");
    assert.equal(comfy.outputType("image", "frame.png", "image/png"), "image");
    assert.equal(comfy.outputType("image", "anim.webp", "image/webp"), "image");
    assert.equal(comfy.outputType("text", "notes.mp4", "text/plain"), "text", "a non-image label is kept");
  });

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

const QUOTA_ENV = ["STUDIO_ACCESS_CODE", "TRUSTED_PROXY_HOPS", "SUBMITS_PER_HOUR_PER_IP", "SUBMITS_PER_HOUR"];

describe("POST /api/jobs", () => {
  beforeEach(async () => {
    for (const name of QUOTA_ENV) delete process.env[name];
    (await import("../lib/access.ts")).resetRateLimits();
  });
  after(() => {
    for (const name of QUOTA_ENV) delete process.env[name];
  });

  type Posted = { status: number; job: import("../lib/types.ts").SubmittedJob & { code?: string } };

  async function post(fields: Record<string, string | File>, options: { dataDir?: string } = {}): Promise<Posted> {
    const dataDir = await mkdtemp(join(tmpdir(), "oss-jobs-"));
    process.env.DATA_DIR = options.dataDir ?? dataDir;
    try {
      const { POST } = await import("../app/api/jobs/route.ts");
      const body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.set(name, value);
      const headers = { "x-forwarded-for": "203.0.113.7" };
      const response = await POST(new Request("http://127.0.0.1/api/jobs", { method: "POST", body, headers }));
      return { status: response.status, job: (await response.json()) as Posted["job"] };
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

  it("drops the unused Klein reference slots, so a one-reference edit doesn't ask Comfy for missing files", async () => {
    const image = new File([new Uint8Array(PNG_1X1)], "ref.png", { type: "image/png" });
    const { status } = await post({ workflow: "klein_edit_multiref", prompt: "the same mug", image_1: image });
    assert.equal(status, 202);
    const graph = mock.state.jobPosts.at(-1)!.body.workflow as Record<string, { inputs: Record<string, unknown> }>;
    for (const node of ["60", "61", "62"]) assert.equal(graph[node], undefined, `LoadImage ${node} removed`);
    assert.ok(graph["54"], "image_1's LoadImage stays");
    assert.deepEqual(
      Object.keys(graph["17"].inputs).filter((key) => key.startsWith("images.")),
      ["images.image0"],
    );
  });

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

  const smoke = (extra: Record<string, string> = {}) => ({
    workflow: "image_resize_smoke",
    image: new File([new Uint8Array(PNG_1X1)], "in.png", { type: "image/png" }),
    ...extra,
  });

  it("rejects a mislabelled upload (JPEG bytes sent as image/png) before any upload or job", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], "in.png", { type: "image/png" });
    const { status, job } = await post({ workflow: "image_resize_smoke", image: jpeg });
    assert.equal(status, 400);
    assert.match(String((job as unknown as { error: string }).error), /does not start like a PNG/);
    assert.equal(mock.state.assetPosts, 0);
    assert.equal(mock.state.jobPosts.length, 0);
  });

  it("wrong access codes don't consume the paid quota", async () => {
    Object.assign(process.env, { STUDIO_ACCESS_CODE: "open-sesame", TRUSTED_PROXY_HOPS: "1", SUBMITS_PER_HOUR_PER_IP: "1" });
    for (let i = 0; i < 5; i += 1) assert.equal((await post(smoke({ access_code: "wrong" }))).status, 401);
    assert.equal((await post(smoke({ access_code: "open-sesame" }))).status, 202, "the one slot is still there");
    const next = await post(smoke({ access_code: "open-sesame" }));
    assert.equal(next.status, 429);
    assert.equal(next.job.code, "rate_limited");
    assert.equal(mock.state.jobPosts.length, 1);
  });

  it("a definitively rejected submit refunds its slot", async () => {
    Object.assign(process.env, { TRUSTED_PROXY_HOPS: "1", SUBMITS_PER_HOUR_PER_IP: "1" });
    mock.setScenario("reject_idempotency");
    assert.equal((await post(smoke())).status, 422);
    mock.setScenario("succeeded");
    assert.equal((await post(smoke())).status, 202, "refunded slot");
  });

  it("an ambiguous submit keeps its slot and is never resubmitted", async () => {
    Object.assign(process.env, { TRUSTED_PROXY_HOPS: "1", SUBMITS_PER_HOUR_PER_IP: "1" });
    mock.setScenario("drop_after_create");
    const first = await post(smoke());
    assert.equal(first.status, 502);
    assert.equal(first.job.code, "submit_ambiguous");
    assert.equal(mock.state.jobPosts.length, 1, "no automatic re-send");
    mock.setScenario("succeeded");
    assert.equal((await post(smoke())).status, 429, "slot kept: a job may exist");
    assert.equal(mock.state.jobPosts.length, 1);
  });

  it("a deadline record that can't be saved still returns the handle (the job is billed)", async () => {
    const blocker = join(await mkdtemp(join(tmpdir(), "oss-blocked-")), "not-a-dir");
    await import("node:fs/promises").then((fs) => fs.writeFile(blocker, "x"));
    const { status, job } = await post(smoke(), { dataDir: blocker });
    assert.equal(status, 202);
    const { readJobHandle } = await import("../lib/access.ts");
    assert.equal(readJobHandle(job.id).jobId, mock.state.jobPosts[0].jobId);
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

describe("GET /api/jobs/:handle", () => {
  async function poll(handle: string) {
    const { GET } = await import("../app/api/jobs/[id]/route.ts");
    const response = await GET(new Request(`http://127.0.0.1/api/jobs/${handle}`), { params: Promise.resolve({ id: handle }) });
    return { status: response.status, job: (await response.json()) as import("../lib/types.ts").Job };
  }

  async function withDataDir<T>(fn: () => Promise<T>): Promise<T> {
    const dataDir = await mkdtemp(join(tmpdir(), "oss-poll-"));
    process.env.DATA_DIR = dataDir;
    try {
      return await fn();
    } finally {
      delete process.env.DATA_DIR;
      await rm(dataDir, { recursive: true, force: true });
    }
  }

  it("a job that finishes after its cancel was requested still delivers its outputs", async () => {
    await withDataDir(async () => {
      mock.setScenario("slow_progress");
      mock.state.cancelBehavior = "pending"; // Comfy says canceling, the job keeps running
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const { createJobHandle } = await import("../lib/access.ts");
      const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt: Date.now() - 16 * 60_000, jobId: submitted.id });

      const first = await poll(handle);
      assert.equal(first.job.terminal, false);
      assert.equal(first.job.error?.code, "cancel_requested", "over budget: cancel requested, still shown as live");
      assert.equal(mock.state.cancels.length, 1);

      let last = first;
      for (let i = 0; i < 30 && !last.job.terminal; i += 1) last = await poll(handle);
      assert.equal(last.job.status, "succeeded");
      assert.equal(last.job.error, null);
      assert.equal(last.job.outputs.length, 1);
      assert.equal(last.job.outputs[0].url, `/api/jobs/${handle}/outputs/${last.job.outputs[0].id}`, "capability URL kept");
    });
  });

  it("a job the deadline canceled says it ran past its time budget, not a plain cancel", async () => {
    await withDataDir(async () => {
      mock.setScenario("unknown_forever");
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const { createJobHandle } = await import("../lib/access.ts");
      const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt: Date.now() - 16 * 60_000, jobId: submitted.id });

      const { job } = await poll(handle);
      assert.deepEqual(mock.state.cancels, [submitted.id]);
      assert.equal(job.status, "canceled");
      assert.equal(job.terminal, true);
      assert.equal(job.error?.code, "deadline_exceeded");
      assert.match(job.error?.message ?? "", /past its 15-minute time budget/);
    });
  });

  it("a job the sweep already canceled (record gone) still says it ran past its time budget", async () => {
    await withDataDir(async () => {
      mock.setScenario("unknown_forever");
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const submittedAt = Date.now() - 16 * 60_000;
      const deadlines = await import("../lib/job-deadlines.ts");
      await deadlines.recordJob(submitted.id, "image_resize_smoke", submittedAt);
      await deadlines.reconcileJobs(client);
      assert.deepEqual(mock.state.cancels, [submitted.id], "the sweep canceled it and dropped its record");
      const { createJobHandle } = await import("../lib/access.ts");
      const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt, jobId: submitted.id });

      const { job } = await poll(handle);
      assert.equal(job.status, "canceled");
      assert.equal(job.error?.code, "deadline_exceeded");
    });
  });

  it("a job canceled inside its deadline is a plain cancel", async () => {
    await withDataDir(async () => {
      mock.setScenario("unknown_forever");
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      await comfy.requestCancel(client, submitted.id);
      const { createJobHandle } = await import("../lib/access.ts");
      const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt: Date.now(), jobId: submitted.id });

      const { job } = await poll(handle);
      assert.equal(job.status, "canceled");
      assert.equal(job.error?.code, "canceled");
    });
  });

  it("a running job keeps the deadline saved at submit when JOB_DEADLINE_MS is raised later", async () => {
    await withDataDir(async () => {
      const saved = process.env.JOB_DEADLINE_MS;
      try {
        mock.setScenario("unknown_forever");
        mock.state.cancelBehavior = "pending";
        const { client, wf } = await smokeWorkflow();
        const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
        const submittedAt = Date.now() - 61_000;
        process.env.JOB_DEADLINE_MS = "60000"; // budget at submit: 1 minute, so overdue now
        const deadlines = await import("../lib/job-deadlines.ts");
        await deadlines.recordJob(submitted.id, "image_resize_smoke", submittedAt);
        const { createJobHandle } = await import("../lib/access.ts");
        const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt, jobId: submitted.id });

        process.env.JOB_DEADLINE_MS = String(60 * 60_000); // raised to an hour while it runs
        const { job } = await poll(handle);
        assert.deepEqual(mock.state.cancels, [submitted.id], "the saved 1-minute deadline still applies");
        assert.equal(job.error?.code, "cancel_requested");
        assert.match(job.error?.message ?? "", /1-minute budget/);
      } finally {
        if (saved === undefined) delete process.env.JOB_DEADLINE_MS;
        else process.env.JOB_DEADLINE_MS = saved;
      }
    });
  });

  it("a running job is not canceled early when JOB_DEADLINE_MS is lowered later", async () => {
    await withDataDir(async () => {
      const saved = process.env.JOB_DEADLINE_MS;
      try {
        mock.setScenario("unknown_forever");
        const { client, wf } = await smokeWorkflow();
        const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
        const submittedAt = Date.now() - 2 * 60_000;
        delete process.env.JOB_DEADLINE_MS; // default 15-minute budget at submit
        const deadlines = await import("../lib/job-deadlines.ts");
        await deadlines.recordJob(submitted.id, "image_resize_smoke", submittedAt);
        const { createJobHandle } = await import("../lib/access.ts");
        const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt, jobId: submitted.id });

        process.env.JOB_DEADLINE_MS = "60000"; // lowered to a minute while it runs
        const { job } = await poll(handle);
        assert.equal(mock.state.cancels.length, 0, "still inside its saved 15-minute deadline");
        assert.equal(job.error, null);
      } finally {
        if (saved === undefined) delete process.env.JOB_DEADLINE_MS;
        else process.env.JOB_DEADLINE_MS = saved;
      }
    });
  });

  it("a 404 from Comfy is retryable until it has lasted MISSING_GRACE_MS, then the job is reported gone", async () => {
    await withDataDir(async () => {
      const { createJobHandle } = await import("../lib/access.ts");
      const deadlines = await import("../lib/job-deadlines.ts");
      const handle = createJobHandle({ binding: "image_resize_smoke", submittedAt: Date.now(), jobId: "no-such-job" });
      await deadlines.recordJob("no-such-job", "image_resize_smoke", Date.now());

      // A first (possibly transient) 404: keep watching, keep the deadline.
      const first = await poll(handle);
      assert.equal(first.status, 503);
      assert.equal((first.job as unknown as { code: string }).code, "job_missing");
      const records = async () => (await readdir(join(process.env.DATA_DIR!, "jobs"))).filter((name) => name.endsWith(".json"));
      assert.equal((await records()).length, 1, "deadline record kept");

      // Another job whose 404s began a whole grace period ago: now it is final.
      const goneHandle = createJobHandle({ binding: "image_resize_smoke", submittedAt: Date.now(), jobId: "long-gone-job" });
      await deadlines.recordJob("long-gone-job", "image_resize_smoke", Date.now());
      await deadlines.confirmMissing("long-gone-job", Date.now() - deadlines.MISSING_GRACE_MS);
      const later = await poll(goneHandle);
      assert.equal(later.status, 200);
      assert.equal(later.job.terminal, true);
      assert.equal(later.job.error?.code, "job_not_found");
      assert.equal((await records()).length, 1, "only the gone job's record dropped");
    });
  });

  it("a valid handle for a workflow that is no longer registered is refused, not served unfiltered", async () => {
    await withDataDir(async () => {
      const { createJobHandle } = await import("../lib/access.ts");
      const { client, wf } = await smokeWorkflow();
      const submitted = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
      const handle = createJobHandle({ binding: "removed_workflow", submittedAt: Date.now(), jobId: submitted.id });
      assert.equal((await poll(handle)).status, 404);
      const { GET } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");
      const response = await GET(new Request(`http://127.0.0.1/api/jobs/${handle}/outputs/x`), {
        params: Promise.resolve({ id: handle, outputId: `out-${submitted.id}` }),
      });
      assert.equal(response.status, 404);
    });
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
