import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { startMockComfy, PNG_1X1, type MockComfy } from "./mock-comfy/server.ts";

let mock: MockComfy;
let dataDir: string;
let comfy: typeof import("../lib/comfy.ts");
let deadlines: typeof import("../lib/job-deadlines.ts");

before(async () => {
  mock = await startMockComfy();
  dataDir = await mkdtemp(join(tmpdir(), "job-deadlines-"));
  process.env.COMFY_BASE_URL = mock.url;
  process.env.COMFY_API_KEY = "mock-key-not-a-secret";
  process.env.DATA_DIR = dataDir;
  process.env.JOB_DEADLINE_MS = "60000";
  comfy = await import("../lib/comfy.ts");
  deadlines = await import("../lib/job-deadlines.ts");
});

after(async () => {
  await mock.close();
  await rm(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  mock.setScenario("unknown_forever");
  mock.state.cancels.length = 0;
  mock.state.cancelBehavior = "ok";
  await rm(join(dataDir, "jobs"), { recursive: true, force: true });
});

async function submitLive() {
  const client = comfy.createClient();
  const wf = await comfy.loadWorkflow(client, "image_resize_smoke");
  wf.setInput("1", "image", client.assets.fromBytes(new Uint8Array(PNG_1X1), { filename: "in.png", contentType: "image/png" }));
  const job = await comfy.submitOnce(client, wf, { idempotencyKey: crypto.randomUUID() });
  return { client, job };
}

const records = async () => (await readdir(join(dataDir, "jobs")).catch(() => [])).filter((name) => name.endsWith(".json"));

describe("server-owned job deadlines", () => {
  it("the sweep cancels an overdue job nobody is polling, and forgets it once Comfy confirms", async () => {
    const { client, job } = await submitLive();
    const submittedAt = Date.now() - 61_000; // the browser walked away a minute ago
    await deadlines.recordJob(job.id, "image_resize_smoke", submittedAt);
    assert.equal((await records()).length, 1);

    const first = await deadlines.reconcileJobs(client);
    assert.deepEqual(mock.state.cancels, [job.id], "canceled without any status request");
    assert.equal(first.cancelRequests, 1);
    assert.equal((await records()).length, 0, "confirmed cancel: record dropped");
  });

  it("leaves fresh jobs alone and drops records of finished ones", async () => {
    const { client, job } = await submitLive();
    await deadlines.recordJob(job.id, "image_resize_smoke", Date.now());
    await deadlines.reconcileJobs(client);
    assert.equal(mock.state.cancels.length, 0);
    assert.equal((await records()).length, 1);

    mock.setScenario("succeeded");
    const { job: done } = await submitLive();
    await comfy.pollJob(client, done.id, { timeoutMs: 5_000, intervalMs: 10 });
    await deadlines.recordJob(done.id, "image_resize_smoke", Date.now() - 120_000);
    await deadlines.reconcileJobs(client);
    assert.ok(!mock.state.cancels.includes(done.id), "a finished job is never canceled");
  });

  it("keeps tracking a job whose cancel failed or is still pending, and retries later", async () => {
    const { client, job } = await submitLive();
    const old = Date.now() - 61_000;
    await deadlines.recordJob(job.id, "image_resize_smoke", old);

    mock.state.cancelBehavior = "error";
    assert.equal(await deadlines.enforceDeadline(client, job.id, old + 60_000), "cancel_failed");
    assert.equal((await records()).length, 1, "still tracked");
    // Throttled: no second cancel request within 30 s.
    await deadlines.enforceDeadline(client, job.id, old + 60_000);
    assert.equal(mock.state.cancels.length, 1);

    mock.state.cancelBehavior = "pending";
    assert.equal(await deadlines.enforceDeadline(client, job.id, old + 60_000, Date.now() + 31_000), "cancel_requested");
    assert.equal((await records()).length, 1, "a pending cancel is not a confirmed one");

    mock.state.cancelBehavior = "ok";
    assert.equal(await deadlines.enforceDeadline(client, job.id, old + 60_000, Date.now() + 62_000), "canceled");
    assert.equal((await records()).length, 0);
  });
});
