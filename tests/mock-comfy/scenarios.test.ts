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
    for (const s of ["multi_output", "slow_progress", "queued_20s"]) assert.ok(body.scenarios.includes(s));
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
