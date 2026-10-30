/**
 * Runner regressions from the PR #7 review (round 3): a status read never
 * waits behind a held run lock, a permanent download error fails at once
 * while a finished job's download gets a short grace past the deadline, and
 * a cancel stops a hung download.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

import type { AnyPipelineDefinition } from "../../lib/pipeline/types.ts";

let dir: string;
let runner: typeof import("../../lib/pipeline/runner.ts");
let store: typeof import("../../lib/store.ts");
type Rt = { client?: unknown };
const rt = () => (globalThis as unknown as { __ossRunner: Rt }).__ossRunner;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "oss-r3-"));
  process.env.COMFY_BASE_URL = "http://comfy.test";
  process.env.COMFY_API_KEY = "test-key";
  process.env.DATA_DIR = dir;
  runner = await import("../../lib/pipeline/runner.ts");
  store = await import("../../lib/store.ts");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

let previousClient: unknown;
let realFetch: typeof fetch | null = null;
afterEach(() => {
  rt().client = previousClient;
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = null;
});
function useClient(client: unknown) {
  previousClient = rt().client;
  rt().client = client;
}

const stamp = () => new Date().toISOString();
const blocked = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"blocked">((r) => setTimeout(() => r("blocked"), ms))]);

async function storeLiveRun(kind: string, deadlineMs: number) {
  const id = crypto.randomUUID();
  await store.saveRun({
    schema: "open-frame-studio/run@1",
    id,
    kind,
    status: "running",
    createdAt: stamp(),
    updatedAt: stamp(),
    timeoutMs: deadlineMs,
    progress: 0,
    request: {},
    result: null,
    error: null,
    steps: [
      {
        id: "shot",
        kind: "comfy",
        workflow: "image_resize_smoke",
        dependsOn: [],
        inputs: {},
        timeoutMs: deadlineMs,
        status: "running",
        jobId: "job-live",
        startedAt: stamp(),
        deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
        submission: { idempotencyKey: "k", state: "accepted", mintedAt: stamp(), attempts: 1 },
      },
    ],
  } as never);
  return id;
}

type Out = { url?: string; toBytes?: (o?: { signal?: AbortSignal }) => Promise<Uint8Array> };
function job(id: string, status: string, out: Out | null) {
  return {
    id,
    status,
    error: null,
    progress: null,
    queuePosition: null,
    outputs: out
      ? [
          {
            id: "o1",
            nodeId: "3",
            name: "out.png",
            type: "image",
            contentType: "image/png",
            sizeBytes: PNG.byteLength,
            getDownloadUrl: async () => ({ url: out.url ?? "http://comfy.test/api/v2/assets/o1/content" }),
            toBytes: out.toBytes ?? (async () => PNG),
          },
        ]
      : [],
    cancel: async () => {},
  };
}

const passthrough = (kind: string, extra: Record<string, unknown> = {}) =>
  ({
    kind,
    validate: (raw: unknown) => ({ ok: true, value: raw }),
    plan: async () => [],
    handlers: {},
    buildResult: async () => null,
    ...extra,
  }) as unknown as AnyPipelineDefinition;

describe("runner review fixes, round 3", () => {
  it("N4: a status read does not wait behind an action holding the run lock", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    useClient({ jobs: { get: async (jobId: string) => job(jobId, "running", null) } });
    runner.registerDefinition(
      passthrough("motion", {
        actions: {
          hold: { method: "POST", path: "hold", run: async () => (await held, { type: "error", status: 409, error: "busy" }) },
        },
      }),
    );
    const id = await storeLiveRun("motion", 60_000);
    const action = runner.runAction("motion", id, "POST", ["hold"], null);
    await new Promise((r) => setTimeout(r, 20));
    const read = await blocked(runner.getRun(id), 1500);
    assert.notEqual(read, "blocked", "the GET must answer while the action holds the lock");
    assert.equal((read as { id: string }).id, id);
    release();
    await action;
    await runner.runAction("motion", id, "POST", ["cancel"], null);
    await runner.whenIdle(id);
  });

  it("5: a missing output fails at once instead of retrying until the deadline", async () => {
    let calls = 0;
    // The poll sees the output; the download's own lookup no longer does.
    useClient({ jobs: { get: async (jobId: string) => job(jobId, "succeeded", calls++ === 0 ? {} : null) } });
    runner.registerDefinition(passthrough("identity"));
    const id = await storeLiveRun("identity", 60_000);
    await runner.getRun(id);
    const done = await blocked(runner.whenIdle(id), 3000);
    assert.notEqual(done, "blocked", "a permanent error must not be retried for a minute");
    const step = (await store.loadRun(id))!.steps[0];
    assert.equal(step.status, "failed");
    assert.equal(step.error?.code, "output_download_failed");
  });

  it("5: an HTTP 403 from storage fails at once; a 503 is retried", async () => {
    realFetch = globalThis.fetch;
    let storage = 0;
    globalThis.fetch = (async () => {
      storage++;
      return new Response("no", { status: storage === 1 ? 503 : 403 });
    }) as typeof fetch;
    useClient({ jobs: { get: async (jobId: string) => job(jobId, "succeeded", { url: "https://storage.example/o1?sig=1" }) } });
    runner.registerDefinition(passthrough("listing"));
    const id = await storeLiveRun("listing", 60_000);
    await runner.getRun(id);
    const done = await blocked(runner.whenIdle(id), 5000);
    assert.notEqual(done, "blocked");
    assert.equal(storage, 2, "the 503 was retried once, the 403 ended it");
    assert.equal((await store.loadRun(id))!.steps[0].status, "failed");
  });

  it("6: a job that finished at the deadline still gets its download retried", async () => {
    let failures = 1;
    const out: Out = {
      toBytes: async () => {
        if (failures-- > 0) throw new Error("fetch failed");
        return PNG;
      },
    };
    runner.registerDefinition(passthrough("photoshoot"));
    const id = await storeLiveRun("photoshoot", 300);
    const deadline = Date.parse((await store.loadRun(id))!.steps[0].deadlineAt!);
    let pastDeadline = 0;
    useClient({
      jobs: {
        // Polling fails until (and once past) the deadline; the job finished meanwhile.
        get: async (jobId: string) => {
          if (Date.now() < deadline || pastDeadline++ === 0) throw new Error("fetch failed");
          return job(jobId, "succeeded", out);
        },
      },
    });
    await runner.getRun(id);
    await runner.whenIdle(id);
    const step = (await store.loadRun(id))!.steps[0];
    assert.equal(step.status, "succeeded", JSON.stringify(step.error));
  });

  it("a cancel stops a hung output download", async () => {
    const out: Out = {
      toBytes: (o) =>
        new Promise((_, reject) => o?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    };
    useClient({ jobs: { get: async (jobId: string) => job(jobId, "succeeded", out) } });
    runner.registerDefinition(passthrough("motion"));
    const id = await storeLiveRun("motion", 60_000);
    await runner.getRun(id);
    await new Promise((r) => setTimeout(r, 100));
    await runner.runAction("motion", id, "POST", ["cancel"], null);
    const done = await blocked(runner.whenIdle(id), 3000);
    assert.notEqual(done, "blocked", "the hung download must stop on cancel");
    const run = (await store.loadRun(id))!;
    assert.equal(run.steps[0].status, "canceled");
    assert.equal(run.status, "canceled");
  });
});
