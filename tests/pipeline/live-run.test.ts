/**
 * Runner regressions from the PR #7 review: the Comfy key never reaches a
 * storage URL, cancel reaches the run being driven, and actions validate
 * against current state instead of waiting for the whole run.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { AnyPipelineDefinition } from "../../lib/pipeline/types.ts";

let dir: string;
let runner: typeof import("../../lib/pipeline/runner.ts");
let store: typeof import("../../lib/store.ts");
type Rt = { client?: unknown };
const rt = () => (globalThis as unknown as { __ossRunner: Rt }).__ossRunner;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "oss-live-"));
  process.env.COMFY_BASE_URL = "http://comfy.test";
  process.env.COMFY_API_KEY = "test-key";
  process.env.DATA_DIR = dir;
  runner = await import("../../lib/pipeline/runner.ts");
  store = await import("../../lib/store.ts");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

const codeStep = (id: string, dependsOn: string[] = []) => ({
  id,
  kind: "code",
  workflow: id,
  dependsOn,
  inputs: {},
  timeoutMs: 10_000,
  status: "pending",
});

async function until(check: () => Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const stepStatus = async (runId: string, stepId: string) =>
  (await store.loadRun(runId))?.steps.find((s) => s.id === stepId)?.status;

describe("runner review fixes", () => {
  it("never sends the Comfy key to a signed storage URL", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const previous = rt().client;
    rt().client = {
      assets: { get: async () => ({ getDownloadUrl: async () => ({ url: "https://storage.example/a.png?sig=1" }) }) },
    };
    try {
      runner.registerDefinition({
        kind: "motion",
        validate: (raw: unknown) => ({ ok: true, value: raw }),
        plan: async () => [codeStep("read")],
        handlers: {
          read: async (ctx: { readBytes: (s: unknown) => Promise<Uint8Array> }) => ({
            data: { size: (await ctx.readBytes({ assetId: "remote-asset" })).byteLength },
          }),
        },
        buildResult: async () => null,
      } as unknown as AnyPipelineDefinition);
      const res = await runner.createRun("motion", {});
      assert.ok(res.ok);
      await runner.whenIdle(res.run.id);
      const run = await store.loadRun(res.run.id);
      assert.equal(run?.status, "succeeded");
      const storage = calls.find((c) => c.url.startsWith("https://storage.example/"));
      assert.ok(storage, "storage URL fetched");
      assert.equal(storage.headers["X-API-Key"], undefined);
      assert.equal(storage.headers.Authorization, undefined);
    } finally {
      globalThis.fetch = realFetch;
      rt().client = previous;
    }
  });

  it("cancel reaches the live run: the dependent step never runs and the run ends canceled", async () => {
    const held = gate();
    let dependentRuns = 0;
    runner.registerDefinition({
      kind: "photoshoot",
      validate: (raw: unknown) => ({ ok: true, value: raw }),
      plan: async () => [codeStep("first"), codeStep("second", ["first"])],
      handlers: {
        first: async () => (await held.opened, {}),
        second: async () => (dependentRuns++, {}),
      },
      buildResult: async () => null,
    } as unknown as AnyPipelineDefinition);
    const res = await runner.createRun("photoshoot", {});
    assert.ok(res.ok);
    const id = res.run.id;
    await until(async () => (await stepStatus(id, "first")) === "running");
    const out = await runner.runAction("photoshoot", id, "POST", ["cancel"], null);
    assert.equal(out.type, "run");
    held.open();
    await runner.whenIdle(id);
    const run = await store.loadRun(id);
    assert.equal(dependentRuns, 0);
    assert.equal(run?.status, "canceled");
    assert.equal(run?.cancelRequested, true);
  });

  it("an action on a running item answers 409 at once; retrying a failed item does not wait for the run", async () => {
    const held = gate();
    let flakyCalls = 0;
    runner.registerDefinition({
      kind: "listing",
      validate: (raw: unknown) => ({ ok: true, value: raw }),
      plan: async () => [codeStep("slow"), codeStep("flaky")],
      handlers: {
        slow: async () => (await held.opened, {}),
        flaky: async () => (++flakyCalls === 1 ? { status: "failed", error: { code: "x", message: "first try" } } : {}),
      },
      buildResult: async () => null,
      actions: {
        retry: {
          method: "POST",
          path: "items/:id/retry",
          run: async (ctx: { run: { steps: { id: string; status: string; [k: string]: unknown }[] }; params: { id: string } }) => {
            const target = ctx.run.steps.find((s) => s.id === ctx.params.id);
            if (!target) return { type: "error", status: 404, error: "no item" };
            if (!["succeeded", "failed", "skipped", "canceled", "timed_out"].includes(target.status)) {
              return { type: "error", status: 409, error: "item is still in progress" };
            }
            return { type: "replan", steps: ctx.run.steps.map((s) => (s.id === target.id ? codeStep(s.id) : s)) };
          },
        },
      },
    } as unknown as AnyPipelineDefinition);
    const res = await runner.createRun("listing", {});
    assert.ok(res.ok);
    const id = res.run.id;
    await until(async () => (await stepStatus(id, "slow")) === "running" && (await stepStatus(id, "flaky")) === "failed");

    const timeout = new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 1000));
    const busy = await Promise.race([runner.runAction("listing", id, "POST", ["items", "slow", "retry"], null), timeout]);
    assert.notEqual(busy, "blocked", "running-item retry must not wait for the run");
    assert.deepEqual(busy, { type: "error", status: 409, error: "item is still in progress" });

    const retried = await Promise.race([runner.runAction("listing", id, "POST", ["items", "flaky", "retry"], null), timeout]);
    assert.notEqual(retried, "blocked", "failed-item retry must not wait for unrelated steps");
    await until(async () => (await stepStatus(id, "flaky")) === "succeeded");
    assert.equal(await stepStatus(id, "slow"), "running");

    held.open();
    await runner.whenIdle(id);
    await until(async () => (await store.loadRun(id))?.status === "succeeded");
    assert.equal(flakyCalls, 2);
  });

  it("concurrent retries on a finished run are both applied", async () => {
    const calls: Record<string, number> = { a: 0, b: 0 };
    const flaky = (id: string) => async () => (++calls[id] === 1 ? { status: "failed", error: { code: "x", message: "first try" } } : {});
    runner.registerDefinition({
      kind: "identity",
      validate: (raw: unknown) => ({ ok: true, value: raw }),
      plan: async () => [codeStep("a"), codeStep("b")],
      handlers: { a: flaky("a"), b: flaky("b") },
      buildResult: async () => null,
      actions: {
        retry: {
          method: "POST",
          path: "items/:id/retry",
          run: async (ctx: { run: { steps: { id: string }[] }; params: { id: string } }) => ({
            type: "replan",
            steps: ctx.run.steps.map((st) => (st.id === ctx.params.id ? codeStep(st.id) : st)),
          }),
        },
      },
    } as unknown as AnyPipelineDefinition);
    const res = await runner.createRun("identity", {});
    assert.ok(res.ok);
    const id = res.run.id;
    await runner.whenIdle(id);
    assert.equal((await store.loadRun(id))?.status, "failed");
    const [ra, rb] = await Promise.all([
      runner.runAction("identity", id, "POST", ["items", "a", "retry"], null),
      runner.runAction("identity", id, "POST", ["items", "b", "retry"], null),
    ]);
    assert.equal(ra.type, "run");
    assert.equal(rb.type, "run");
    await until(async () => (await store.loadRun(id))?.status === "succeeded");
    assert.deepEqual(calls, { a: 2, b: 2 });
  });

  it("a code step past its deadline times out even if the handler ignores the signal", async () => {
    runner.registerDefinition({
      kind: "motion",
      validate: (raw: unknown) => ({ ok: true, value: raw }),
      plan: async () => [{ ...codeStep("slow"), timeoutMs: 30 }],
      handlers: { slow: async () => (await new Promise((r) => setTimeout(r, 200)), {}) },
      buildResult: async () => null,
    } as unknown as AnyPipelineDefinition);
    const res = await runner.createRun("motion", {});
    assert.ok(res.ok);
    await runner.whenIdle(res.run.id);
    assert.equal(await stepStatus(res.run.id, "slow"), "timed_out");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await stepStatus(res.run.id, "slow"), "timed_out");
  });

  it("recovering a canceled run asks Comfy to stop its live jobs", async () => {
    const canceled: string[] = [];
    const previous = rt().client;
    rt().client = {
      jobs: {
        get: async (jobId: string) => ({
          id: jobId,
          get status() {
            return canceled.includes(jobId) ? "canceled" : "running";
          },
          outputs: [],
          error: null,
          progress: null,
          queuePosition: null,
          cancel: async () => void canceled.push(jobId),
        }),
      },
    };
    try {
      runner.registerDefinition({
        kind: "listing",
        validate: (raw: unknown) => ({ ok: true, value: raw }),
        plan: async () => [],
        handlers: {},
        buildResult: async () => null,
      } as unknown as AnyPipelineDefinition);
      const id = crypto.randomUUID();
      const stamp = new Date().toISOString();
      await store.saveRun({
        schema: "open-frame-studio/run@1",
        id,
        kind: "listing",
        status: "running",
        createdAt: stamp,
        updatedAt: stamp,
        timeoutMs: 60_000,
        progress: 0,
        cancelRequested: true,
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
            startedAt: stamp,
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
            submission: { idempotencyKey: "k", state: "accepted", mintedAt: stamp, attempts: 1 },
          },
        ],
      } as never);
      await runner.getRun(id);
      await runner.whenIdle(id);
      const run = await store.loadRun(id);
      assert.deepEqual(canceled, ["job-live"]);
      assert.equal(run?.status, "canceled");
      assert.equal(run?.steps[0].status, "canceled");
      assert.equal(run?.steps[0].error?.code, "canceled");
    } finally {
      rt().client = previous;
    }
  });
});
