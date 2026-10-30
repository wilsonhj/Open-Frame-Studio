/**
 * Runner and create-path regressions from the PR #7 review (round 1): a
 * transient poll/download error never fails a billed job, cancel and a
 * resuming GET share one run object, actions are refused while a cancel winds
 * down, a cancel during the ambiguous-submit backoff reports the possible
 * charge, a failed write raises no unhandled rejection, and one request can't
 * multiply uploads.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
  dir = await mkdtemp(join(tmpdir(), "oss-r1-"));
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

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

async function until(check: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const stamp = () => new Date().toISOString();

/** A stored, non-terminal run with one comfy step already accepted by Comfy. */
async function storeLiveRun(kind: string, extraSteps: unknown[] = []) {
  const id = crypto.randomUUID();
  await store.saveRun({
    schema: "open-frame-studio/run@1",
    id,
    kind,
    status: "running",
    createdAt: stamp(),
    updatedAt: stamp(),
    timeoutMs: 60_000,
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
        timeoutMs: 60_000,
        status: "running",
        jobId: "job-live",
        startedAt: stamp(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        submission: { idempotencyKey: "k", state: "accepted", mintedAt: stamp(), attempts: 1 },
      },
      ...extraSteps,
    ],
  } as never);
  return id;
}

/** A fake SDK job whose status reads live from `state`. */
function sdkJob(id: string, state: { status: string; cancels: string[]; cancelGate?: Promise<void>; bytesFailures?: number }) {
  return {
    id,
    get status() {
      return state.status;
    },
    error: null,
    progress: null,
    queuePosition: null,
    outputs:
      state.status === "succeeded"
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
    cancel: async () => {
      await state.cancelGate;
      state.cancels.push(id);
      state.status = "canceled";
    },
  };
}

const passthrough = (kind: string, extra: Partial<Record<string, unknown>> = {}) =>
  ({
    kind,
    validate: (raw: unknown) => ({ ok: true, value: raw }),
    plan: async () => [],
    handlers: {},
    buildResult: async () => null,
    ...extra,
  }) as unknown as AnyPipelineDefinition;

describe("runner review round 1", () => {
  it("R1: a failed poll and a failed download do not fail a billed job", async () => {
    const state = { status: "succeeded", cancels: [] as string[], bytesFailures: 1 };
    let gets = 0;
    let submits = 0;
    useClient({
      submit: async () => (submits++, sdkJob("dup", state)),
      jobs: {
        get: async (jobId: string) => {
          if (++gets === 1) throw new TypeError("fetch failed");
          return sdkJob(jobId, state);
        },
      },
    });
    runner.registerDefinition(passthrough("motion"));
    const id = await storeLiveRun("motion");
    await runner.getRun(id);
    await until(async () => ["succeeded", "failed", "partial"].includes((await store.loadRun(id))?.status ?? ""), 15_000);
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.equal(run?.steps[0].status, "succeeded", JSON.stringify(run?.steps[0].error));
    assert.equal(run?.steps[0].jobId, "job-live");
    assert.equal(run?.steps[0].outputs?.length, 1);
    assert.equal(submits, 0, "never resubmitted");
    assert.equal(run?.status, "succeeded");
  });

  it("R2: a cancel racing a resuming GET reaches the run that is driven", async () => {
    const state = { status: "running", cancels: [] as string[] };
    useClient({ jobs: { get: async (jobId: string) => sdkJob(jobId, state) } });
    runner.registerDefinition(passthrough("listing"));
    const id = await storeLiveRun("listing");
    await Promise.all([runner.runAction("listing", id, "POST", ["cancel"], null), runner.getRun(id)]);
    await until(async () => (await store.loadRun(id))?.status === "canceled", 8000);
    await runner.whenIdle(id);
    assert.deepEqual(state.cancels, ["job-live"]);
    const run = await store.loadRun(id);
    assert.equal(run?.cancelRequested, true);
    assert.equal(run?.steps[0].status, "canceled");
  });

  it("R3: a retry while a cancel is winding down is refused, not silently dropped", async () => {
    const held = gate();
    const state = { status: "running", cancels: [] as string[], cancelGate: held.opened };
    useClient({ jobs: { get: async (jobId: string) => sdkJob(jobId, state) } });
    let flakyCalls = 0;
    runner.registerDefinition(
      passthrough("identity", {
        handlers: { flaky: async () => (flakyCalls++, {}) },
        actions: {
          retry: {
            method: "POST",
            path: "items/:id/retry",
            run: async (ctx: { run: { steps: { id: string }[] }; params: { id: string } }) => ({
              type: "replan",
              steps: ctx.run.steps.map((st) =>
                st.id === ctx.params.id ? { id: st.id, kind: "code", workflow: "flaky", dependsOn: [], inputs: {}, timeoutMs: 5000, status: "pending" } : st,
              ),
            }),
          },
        },
      }),
    );
    const id = await storeLiveRun("identity", [
      { id: "flaky", kind: "code", workflow: "flaky", dependsOn: [], inputs: {}, timeoutMs: 5000, status: "failed", error: { code: "x", message: "first try" } },
    ]);
    await runner.getRun(id);
    await until(() => runner.whenIdle(id) !== Promise.resolve());
    await new Promise((r) => setTimeout(r, 50));
    await runner.runAction("identity", id, "POST", ["cancel"], null);
    await new Promise((r) => setTimeout(r, 50));
    // The upstream cancel is held open, so the run is still winding down.
    assert.notEqual(runner.whenIdle(id), undefined);
    assert.ok(!["succeeded", "partial", "failed", "canceled"].includes((await runner.getRun(id))!.status), "still winding down");
    const retry = await runner.runAction("identity", id, "POST", ["items", "flaky", "retry"], null);
    held.open();
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.deepEqual(retry, { type: "error", status: 409, error: retry.type === "error" ? retry.error : "" });
    assert.equal(retry.type, "error");
    assert.equal(flakyCalls, 0, "a refused retry never runs");
    assert.equal(run?.status, "canceled");
    assert.equal(run?.steps.find((st) => st.id === "flaky")?.status, "failed", "the item keeps its state");
  });

  it("R4: cancel during the ambiguous-submit backoff reports the possible charge", async () => {
    let submits = 0;
    useClient({
      submit: async () => {
        submits++;
        throw new TypeError("fetch failed");
      },
      workflows: { fromJson: (g: unknown) => g },
      assets: { get: async () => ({ asReference: async () => ({ __type: "core/ASSET", info: { id: "a1" } }) }) },
    });
    runner.registerDefinition(
      passthrough("motion", {
        plan: async () => [
          { id: "shot", kind: "comfy", workflow: "image_resize_smoke", dependsOn: [], inputs: { image: "a1" }, timeoutMs: 60_000, status: "pending" },
        ],
      }),
    );
    const res = await runner.createRun("motion", {});
    assert.ok(res.ok);
    const id = res.run.id;
    await until(() => submits >= 1);
    await new Promise((r) => setTimeout(r, 30));
    const started = Date.now();
    await runner.runAction("motion", id, "POST", ["cancel"], null);
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.equal(run?.status, "canceled");
    assert.equal(run?.steps[0].status, "canceled");
    assert.equal(run?.steps[0].error?.code, "submit_unconfirmed");
    assert.ok(Date.now() - started < 900, "the backoff wakes on cancel");
  });

  it("R5: a failed run write raises no unhandled rejection", async () => {
    let unhandled = 0;
    const onUnhandled = () => void unhandled++;
    process.on("unhandledRejection", onUnhandled);
    const fileAsDir = join(dir, "not-a-dir");
    await writeFile(fileAsDir, "x");
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = fileAsDir;
    try {
      await assert.rejects(store.saveRun({ id: "write-fail", steps: [] } as never));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.env.DATA_DIR = prev;
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(unhandled, 0);
  });

  it("S1: one request uploads each part once, checks parts first, and leaves nothing behind on failure", async () => {
    let commits = 0;
    useClient({
      assets: {
        fromBytes: () => ({ commit: async () => `asset-${++commits}` }),
      },
    });
    const part = { bytes: PNG, filename: "p.png", contentType: "image/png" };
    runner.registerDefinition(passthrough("motion"));

    const many = await runner.createRun("motion", { images: Array.from({ length: 5 }, () => ({ upload: "p" })) }, new Map([["p", part]]));
    assert.ok(many.ok);
    assert.equal(commits, 1, "one upload per distinct part");
    const ids = new Set((many.run.request as { images: { assetId: string }[] }).images.map((i) => i.assetId));
    assert.equal(ids.size, 1);

    commits = 0;
    const before = new Set(await readdir(join(dir, "runs")).catch(() => []));
    const missing = await runner.createRun("motion", { images: [{ upload: "p" }, { upload: "nope" }] }, new Map([["p", part]]));
    assert.equal(missing.ok, false);
    assert.equal(commits, 0, "a missing part is caught before any upload");

    const parts = new Map(Array.from({ length: 9 }, (_, i) => [`p${i}`, part] as const));
    const tooMany = await runner.createRun("motion", { images: [...parts.keys()].map((upload) => ({ upload })) }, parts);
    assert.equal(tooMany.ok, false);
    assert.equal(commits, 0, "too many parts is caught before any upload");

    runner.registerDefinition(
      passthrough("motion", {
        plan: async () => {
          throw Object.assign(new Error("bad mode"), { status: 400, field: "mode" });
        },
      }),
    );
    const planFail = await runner.createRun("motion", { images: [{ upload: "p" }] }, new Map([["p", part]]));
    assert.equal(planFail.ok, false);
    assert.equal(commits, 1);
    assert.equal((planFail as { assetsCreated?: boolean }).assetsCreated, true, "the route must not refund a slot that created assets");
    const after = (await readdir(join(dir, "runs")).catch(() => [])).filter((n) => !before.has(n) && !n.endsWith(".json"));
    assert.deepEqual(after, [], "no orphaned run directory");

    const shoot = await runner.createRun(
      "photoshoot",
      { mode: "packshot", prompt: "", count: 1, images: Array.from({ length: 7 }, () => ({ upload: "p" })) },
      new Map([["p", part]]),
    );
    assert.equal(shoot.ok, false);
    assert.equal((shoot as { field?: string }).field, "images");
  });

  it("S3: a GET action cannot replan (bill) a run", async () => {
    runner.registerDefinition(
      passthrough("listing", {
        actions: { peek: { method: "GET", path: "peek", run: async (ctx: { run: { steps: unknown[] } }) => ({ type: "replan", steps: ctx.run.steps }) } },
      }),
    );
    useClient({});
    const res = await runner.createRun("listing", {});
    assert.ok(res.ok);
    await runner.whenIdle(res.run.id);
    const out = await runner.runAction("listing", res.run.id, "GET", ["peek"], null);
    assert.equal(out.type, "error");
  });

  it("S4: a credentialed asset download never follows a redirect", async () => {
    const inits: RequestInit[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
      inits.push(init ?? {});
      return new Response(PNG);
    }) as typeof fetch;
    useClient({ assets: { get: async () => ({ getDownloadUrl: async () => ({ url: "/api/v2/assets/a9/content" }) }) } });
    try {
      runner.registerDefinition(
        passthrough("motion", {
          plan: async () => [{ id: "read", kind: "code", workflow: "read", dependsOn: [], inputs: {}, timeoutMs: 5000, status: "pending" }],
          handlers: { read: async (ctx: { readBytes: (s: unknown) => Promise<Uint8Array> }) => ({ data: { n: (await ctx.readBytes({ assetId: "a9" })).byteLength } }) },
        }),
      );
      const res = await runner.createRun("motion", {});
      assert.ok(res.ok);
      await runner.whenIdle(res.run.id);
      assert.equal((await store.loadRun(res.run.id))?.status, "succeeded");
      const credentialed = inits.find((i) => (i.headers as Record<string, string> | undefined)?.["X-API-Key"]);
      assert.ok(credentialed, "same-origin download carries the key");
      assert.notEqual(credentialed.redirect ?? "follow", "follow");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
