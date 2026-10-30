/**
 * Runner regressions from the PR #7 re-review (round 2): a finished job's
 * output download is retried until the step deadline, a job that ended
 * upstream is reported as it ended at the poll deadline, and a refused
 * create waits for every started upload before deciding the refund.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
  dir = await mkdtemp(join(tmpdir(), "oss-r2-"));
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
afterEach(() => {
  rt().client = previousClient;
});
function useClient(client: unknown) {
  previousClient = rt().client;
  rt().client = client;
}

const stamp = () => new Date().toISOString();

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

function job(id: string, status: string, state: { cancels: string[]; bytesFailures?: number }) {
  return {
    id,
    status,
    error: null,
    progress: null,
    queuePosition: null,
    outputs:
      status === "succeeded"
        ? [
            {
              id: "o1",
              nodeId: "3",
              name: "out.png",
              type: "image",
              contentType: "image/png",
              sizeBytes: PNG.byteLength,
              getDownloadUrl: async () => ({ url: "http://comfy.test/api/v2/assets/o1/content" }),
              toBytes: async () => {
                if ((state.bytesFailures ?? 0) > 0) {
                  state.bytesFailures!--;
                  throw new Error("fetch failed");
                }
                return PNG;
              },
            },
          ]
        : [],
    cancel: async () => void state.cancels.push(id),
  };
}

const passthrough = (kind: string) =>
  ({
    kind,
    validate: (raw: unknown) => ({ ok: true, value: raw }),
    plan: async () => [],
    handlers: {},
    buildResult: async () => null,
  }) as unknown as AnyPipelineDefinition;

describe("runner review fixes, round 2", () => {
  it("keeps retrying a finished job's output download until it succeeds", async () => {
    const state = { cancels: [] as string[], bytesFailures: 4 };
    useClient({ jobs: { get: async (id: string) => job(id, "succeeded", state) } });
    runner.registerDefinition(passthrough("motion"));
    const id = await storeLiveRun("motion", 60_000);
    await runner.getRun(id);
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.equal(run?.steps[0].status, "succeeded", JSON.stringify(run?.steps[0].error));
    assert.equal(state.bytesFailures, 0);
  });

  it("reports a job that ended upstream as it ended when polling fails until the deadline", async () => {
    const state = { cancels: [] as string[] };
    runner.registerDefinition(passthrough("identity"));
    const id = await storeLiveRun("identity", 400);
    const deadline = Date.parse((await store.loadRun(id))!.steps[0].deadlineAt!);
    useClient({
      jobs: {
        // Every poll that starts before the step deadline fails, and the one in
        // flight at the deadline fails only after it has passed (as on a slow
        // network), so the runner's deadline branch takes the last look
        // whatever the timing; the job ended upstream meanwhile.
        get: async (jobId: string) => {
          const wait = deadline - Date.now();
          if (wait >= 0) {
            await new Promise((r) => setTimeout(r, wait + 20));
            throw new Error("fetch failed");
          }
          return job(jobId, "failed", state);
        },
      },
    });
    await runner.getRun(id);
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.equal(run?.steps[0].status, "failed");
    assert.notEqual(run?.steps[0].error?.code, "poll_failed");
    assert.deepEqual(state.cancels, []);
  });

  it("a refused create counts every started upload and leaves no files behind", async () => {
    let commits = 0;
    useClient({
      assets: {
        fromBytes: (_bytes: Uint8Array, opts: { filename: string }) => ({
          commit: async () => {
            if (opts.filename === "a.png") throw new Error("boom");
            await new Promise((r) => setTimeout(r, 100));
            commits++;
            return "asset-b";
          },
        }),
      },
    });
    runner.registerDefinition(passthrough("listing"));
    const part = (filename: string) => ({ bytes: PNG, filename, contentType: "image/png" });
    const runsBefore = await readdir(join(dir, "runs")).catch(() => [] as string[]);
    const res = await runner.createRun(
      "listing",
      { images: [{ upload: "a" }, { upload: "b" }] },
      new Map([
        ["a", part("a.png")],
        ["b", part("b.png")],
      ]),
    );
    assert.equal(res.ok, false);
    assert.equal(commits, 1);
    assert.equal(!res.ok && res.assetsCreated, true, "the committed upload keeps the slot");
    await new Promise((r) => setTimeout(r, 50));
    const runsAfter = await readdir(join(dir, "runs")).catch(() => [] as string[]);
    assert.deepEqual(runsAfter.sort(), runsBefore.sort(), "no orphaned run folder");
  });
});
