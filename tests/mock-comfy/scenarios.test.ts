/** Raw-HTTP checks for the mock's Wave 2 scenarios (no SDK involved). */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { mockRequests, resetMock, setMockScenario } from "./control.ts";
import { MP4_STUB, SLOW_PROGRESS_POLLS, startMockComfy, type MockComfy } from "./server.ts";

const GRAPH = { "1": { class_type: "SaveImage", inputs: {} } };
let mock: MockComfy;

before(async () => {
  mock = await startMockComfy();
});
after(async () => {
  await mock.close();
});
beforeEach(async () => {
  await resetMock(mock.url);
});

async function submit(): Promise<string> {
  const response = await fetch(`${mock.url}/api/v2/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ workflow: GRAPH }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

type JobBody = {
  status: string;
  queue_position: number | null;
  progress: { value: number; nodes_done: number; nodes_total: number } | null;
  outputs: Array<{ id: string; type: string; content_type: string; node_id: string; url: string }>;
};

async function poll(id: string): Promise<JobBody> {
  return (await (await fetch(`${mock.url}/api/v2/jobs/${id}`)).json()) as JobBody;
}

describe("mock control endpoints", () => {
  test("health lists every scenario", async () => {
    const body = (await (await fetch(`${mock.url}/__mock/health`)).json()) as { ok: boolean; scenarios: string[] };
    assert.equal(body.ok, true);
    for (const s of ["multi_output", "slow_progress", "queued_20s", "asset_missing", "drop_after_create"]) assert.ok(body.scenarios.includes(s));
  });

  test("unknown scenario is refused, state unchanged", async () => {
    const response = await fetch(`${mock.url}/__mock/scenario`, {
      method: "POST",
      body: JSON.stringify({ scenario: "nope" }),
    });
    assert.equal(response.status, 422);
    assert.equal(mock.state.scenario, "succeeded");
  });

  test("requests are recorded and reset clears them", async () => {
    await submit();
    const seen = await mockRequests(mock.url);
    assert.equal(seen.jobPosts.length, 1);
    assert.ok(seen.jobPosts[0].idempotencyKey);
    await setMockScenario({ scenario: "failed", queuedMs: 5 }, mock.url);
    const after = await resetMock(mock.url);
    assert.deepEqual(after, { scenario: "succeeded", contentMode: "proxy", queuedMs: 20_000 });
    assert.equal((await mockRequests(mock.url)).jobPosts.length, 0);
  });
});

describe("multi_output", () => {
  test("succeeds with two images and one video, all downloadable", async () => {
    await setMockScenario({ scenario: "multi_output" }, mock.url);
    const id = await submit();
    let job = await poll(id);
    while (job.status !== "succeeded") job = await poll(id);
    assert.deepEqual(
      job.outputs.map((o) => [o.type, o.content_type, o.node_id]),
      [
        ["image", "image/png", "9"],
        ["image", "image/png", "9"],
        ["video", "video/mp4", "12"],
      ],
    );
    assert.equal(new Set(job.outputs.map((o) => o.id)).size, 3);
    const video = await fetch(job.outputs[2].url);
    assert.equal(video.headers.get("content-type"), "video/mp4");
    assert.ok(Buffer.from(await video.arrayBuffer()).equals(MP4_STUB));
  });
});

describe("slow_progress", () => {
  test("reports monotonically rising progress before succeeding", async () => {
    await setMockScenario({ scenario: "slow_progress" }, mock.url);
    const id = await submit();
    const values: number[] = [];
    let job = await poll(id);
    while (job.status !== "succeeded") {
      assert.equal(job.status, "running");
      assert.ok(job.progress);
      values.push(job.progress.value);
      job = await poll(id);
    }
    assert.equal(values.length, SLOW_PROGRESS_POLLS);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
    assert.ok(values.every((v) => v >= 0 && v < 1));
    assert.equal(job.outputs.length, 1);
  });
});

describe("queued_20s", () => {
  test("stays queued until queuedMs elapses, then runs once and succeeds", async () => {
    await setMockScenario({ scenario: "queued_20s", queuedMs: 300 }, mock.url);
    const id = await submit();
    const early = await poll(id);
    assert.equal(early.status, "queued");
    assert.ok((early.queue_position ?? 0) >= 1);
    assert.equal((await poll(id)).status, "queued");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal((await poll(id)).status, "running");
    const done = await poll(id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.outputs.length, 1);
  });
});

async function uploadAsset(): Promise<string> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "ref_0.png");
  form.set("content_type", "image/png");
  form.set("file_path", "ref_0.png");
  const response = await fetch(`${mock.url}/api/v2/assets`, { method: "POST", body: form });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

function graphUsing(assetId: string) {
  return {
    "1": { class_type: "LoadImage", inputs: { image: { __type: "core/ASSET", info: { id: assetId } } } },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
  };
}

describe("asset_missing", () => {
  test("named asset ids answer 404, others stay available; job POSTs record the asset ids they used", async () => {
    const stale = await uploadAsset();
    const fresh = await uploadAsset();
    await setMockScenario({ scenario: "asset_missing", missingAssetIds: [stale] }, mock.url);

    assert.equal((await fetch(`${mock.url}/api/v2/assets/${stale}`)).status, 404);
    assert.equal((await fetch(`${mock.url}/api/v2/assets/${stale}/content`)).status, 404);
    assert.equal((await fetch(`${mock.url}/api/v2/assets/${fresh}`)).status, 200);

    const post = (workflow: unknown) =>
      fetch(`${mock.url}/api/v2/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ workflow }),
      });
    const refused = await post(graphUsing(stale));
    assert.equal(refused.status, 422);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "asset_not_found");
    const accepted = await post(graphUsing(fresh));
    assert.equal(accepted.status, 201);
    const jobId = ((await accepted.json()) as { id: string }).id;

    const seen = await mockRequests(mock.url);
    assert.deepEqual(
      seen.jobPosts.map((p) => [p.assetIds, p.jobId]),
      [
        [[stale], null],
        [[fresh], jobId],
      ],
    );
    let job = await poll(jobId);
    while (job.status !== "succeeded") job = await poll(jobId);
  });

  test("reset clears the missing set", async () => {
    const id = await uploadAsset();
    await setMockScenario({ scenario: "asset_missing", missingAssetIds: [id] }, mock.url);
    await resetMock(mock.url);
    assert.equal(mock.state.missingAssetIds.size, 0);
    assert.equal((await fetch(`${mock.url}/api/v2/assets/${id}`)).status, 200);
  });
});

describe("drop_after_create", () => {
  test("creates the job but drops the connection; a same-key re-send gets 422 reuse", async () => {
    await setMockScenario({ scenario: "drop_after_create" }, mock.url);
    const key = crypto.randomUUID();
    const send = () =>
      fetch(`${mock.url}/api/v2/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ workflow: GRAPH }),
      });
    await assert.rejects(send(), TypeError, "the first POST gets no response");
    const again = await send();
    assert.equal(again.status, 422);
    assert.equal(((await again.json()) as { error: { code: string } }).error.code, "idempotency_key_reuse");

    const seen = await mockRequests(mock.url);
    assert.equal(seen.jobPosts.length, 2);
    assert.deepEqual(
      seen.jobPosts.map((p) => p.idempotencyKey),
      [key, key],
    );
    const created = seen.jobPosts.filter((p) => p.jobId !== null);
    assert.equal(created.length, 1, "exactly one job exists");
    assert.equal((await poll(created[0].jobId!)).status, "running");
  });
});
