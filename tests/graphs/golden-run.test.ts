import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { WORKFLOW_NAMES } from "../../lib/types.ts";
import { startMockComfy, type MockComfy } from "../mock-comfy/server.ts";
// @ts-expect-error: plain .mjs script, no type declarations
import * as golden from "../../scripts/golden-run.mjs";

type Entry = { workflow: string; images: Record<string, string>; values: Record<string, unknown>; cost: { count: number } };
type Run = { status: string; jobId: string | null; idempotencyKey: string; terminal?: boolean; outputs?: Array<{ nodeId: string; sha256: string }> };

const GOLDEN = golden.GOLDEN as Entry[];
const quiet = { log: () => {} };

describe("golden-run: plan and guards (offline)", () => {
  it("has exactly one golden job per registered workflow", () => {
    assert.deepEqual(GOLDEN.map((e) => e.workflow).sort(), [...WORKFLOW_NAMES].sort());
    for (const e of GOLDEN) assert.equal(e.cost.count, 1, e.workflow);
  });

  it("every golden graph binds cleanly and passes the object_info check", async () => {
    assert.deepEqual(await golden.dryRun(), []);
  });

  it("refuses --live without --spend-credits, a backend, or named workflows", () => {
    const args = (argv: string[]) => golden.parseArgs(argv);
    const key = { COMFY_API_KEY: "k" };
    assert.match(golden.liveRefusal(args(["--live", "--all"]), key), /--spend-credits/);
    assert.match(golden.liveRefusal(args(["--live", "--spend-credits", "--all"]), {}), /COMFY_API_KEY/);
    assert.match(golden.liveRefusal(args(["--live", "--spend-credits"]), key), /--workflow/);
    assert.equal(golden.liveRefusal(args(["--live", "--spend-credits", "--workflow", "cutout"]), key), null);
    assert.equal(golden.liveRefusal(args(["--live", "--spend-credits", "--all"]), { COMFY_BASE_URL: "http://127.0.0.1:8188" }), null);
    assert.equal(golden.liveRefusal(args([]), {}), null, "dry run needs nothing");
    assert.throws(() => golden.selectPlan(args(["--workflow", "nope"])), /unknown workflow/);
    assert.throws(() => golden.parseArgs(["--yolo"]), /unknown argument/);
  });

  it("refuses --all together with --workflow (live refusal, and an error in dry/mock runs)", () => {
    const args = golden.parseArgs(["--live", "--spend-credits", "--all", "--workflow", "cutout"]);
    assert.match(golden.liveRefusal(args, { COMFY_API_KEY: "k" }), /--all and --workflow are exclusive/);
    assert.throws(() => golden.selectPlan(golden.parseArgs(["--all", "--workflow", "cutout"])), /--all and --workflow are exclusive/);
    assert.throws(() => golden.selectPlan(golden.parseArgs(["--mock", "--workflow", "cutout", "--all"])), /exclusive/);
    assert.equal(golden.selectPlan(golden.parseArgs(["--all"])).length, GOLDEN.length);
  });
});

describe("golden-run: SIGINT/SIGTERM during a pass (no network)", () => {
  type Call = { cancel: Array<[string, unknown]>; write: Array<[string, Record<string, unknown>]>; exit: number[] };
  const harness = (current: unknown, outcome = { outcome: "cancel_requested", job: { status: "running" } }) => {
    const calls: Call = { cancel: [], write: [], exit: [] };
    const handler = golden.makeSignalHandler({
      getInFlight: () => current,
      cancel: async (jobId: string, ctx: unknown) => {
        calls.cancel.push([jobId, ctx]);
        return outcome;
      },
      write: (path: string, value: Record<string, unknown>) => calls.write.push([path, structuredClone(value)]),
      exit: (code: number) => calls.exit.push(code),
      log: () => {},
    }) as (signal: string) => Promise<void>;
    return { calls, handler };
  };

  it("cancels the in-flight job, records it in run.json and exits 130 on SIGINT", async () => {
    const current = { client: "c", recordPath: "/x/run.json", record: { workflow: "cutout", jobId: "job-1", status: "running" } };
    const { calls, handler } = harness(current, { outcome: "canceled", job: { status: "cancelled" } });
    await handler("SIGINT");
    assert.deepEqual(calls.cancel, [["job-1", current]]);
    assert.equal(calls.write.length, 1);
    const [path, record] = calls.write[0];
    assert.equal(path, "/x/run.json");
    assert.equal(record.status, "cancelled");
    assert.deepEqual((record.interrupted as { signal: string; cancel: unknown }).cancel, { outcome: "canceled" });
    assert.equal((record.interrupted as { signal: string }).signal, "SIGINT");
    assert.deepEqual(calls.exit, [130]);
  });

  it("records a failed cancel, ignores a second signal, exits 143 on SIGTERM", async () => {
    const current = { client: "c", recordPath: "/x/run.json", record: { workflow: "cutout", jobId: "job-2", status: "running" } };
    const { calls, handler } = harness(current, { outcome: "cancel_failed", job: null, error: "boom" } as never);
    await Promise.all([handler("SIGTERM"), handler("SIGTERM")]);
    assert.equal(calls.cancel.length, 1);
    assert.deepEqual((calls.write[0][1].interrupted as { cancel: unknown }).cancel, { outcome: "cancel_failed", error: "boom" });
    assert.equal(calls.write[0][1].status, "running");
    assert.deepEqual(calls.exit, [143]);
  });

  it("before a job id exists: writes run.json (key kept) without cancelling; with nothing in flight: just exits", async () => {
    const pending = { client: "c", recordPath: "/x/run.json", record: { workflow: "cutout", jobId: null, idempotencyKey: "k1", status: "pending" } };
    const a = harness(pending);
    await a.handler("SIGINT");
    assert.equal(a.calls.cancel.length, 0);
    assert.equal(a.calls.write[0][1].idempotencyKey, "k1");
    assert.deepEqual(a.calls.exit, [130]);
    const b = harness(null);
    await b.handler("SIGINT");
    assert.deepEqual([b.calls.cancel.length, b.calls.write.length, b.calls.exit], [0, 0, [130]]);
  });
});

describe("golden-run against the mock (submit discipline)", () => {
  let mock: MockComfy;
  let out: string;
  const smoke = () => GOLDEN.find((e) => e.workflow === "image_resize_smoke")!;
  const recordOf = (): Run => JSON.parse(readFileSync(join(out, "image_resize_smoke/run.json"), "utf8"));

  before(async () => {
    mock = await startMockComfy({ port: 0 });
    process.env.COMFY_BASE_URL = mock.url;
    delete process.env.COMFY_API_KEY;
  });
  after(async () => {
    await mock.close();
    delete process.env.COMFY_BASE_URL;
  });
  beforeEach(async () => {
    await fetch(`${mock.url}/__mock/reset`, { method: "POST" });
    out = mkdtempSync(join(tmpdir(), "golden-test-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("runs every golden workflow end to end and records only declared outputs", async () => {
    for (const entry of GOLDEN) {
      const run = (await golden.runOne(entry, { outDir: out, ...quiet })) as Run;
      assert.equal(run.status, "succeeded", entry.workflow);
      assert.ok(run.outputs!.length >= 1, entry.workflow);
      for (const o of run.outputs!) assert.match(o.sha256, /^[0-9a-f]{64}$/);
    }
    assert.equal(mock.state.jobPosts.length, GOLDEN.length, "one POST per workflow");
  });

  it("a finished record is not submitted again", async () => {
    await golden.runOne(smoke(), { outDir: out, ...quiet });
    await golden.runOne(smoke(), { outDir: out, ...quiet });
    assert.equal(mock.state.jobPosts.length, 1);
  });

  it("a recorded job id is resumed by polling, never re-POSTed", async () => {
    await golden.runOne(smoke(), { outDir: out, ...quiet });
    const first = recordOf();
    // Simulate a crash after submit: the record has a job id but no terminal state.
    writeFileSync(join(out, "image_resize_smoke/run.json"), JSON.stringify({ ...first, status: "running", terminal: false }));
    const resumed = (await golden.runOne(smoke(), { outDir: out, ...quiet })) as Run;
    assert.equal(resumed.jobId, first.jobId);
    assert.equal(resumed.status, "succeeded");
    assert.equal(mock.state.jobPosts.length, 1, "no second POST");
  });

  it("drop_after_create: ambiguous, then a same-key re-send gets 422 -> submit_unconfirmed; one job, never a new key", async () => {
    mock.setScenario("drop_after_create");
    const first = (await golden.runOne(smoke(), { outDir: out, ...quiet })) as Run;
    assert.equal(first.status, "submit_ambiguous");
    assert.equal(recordOf().idempotencyKey, first.idempotencyKey, "key persisted");
    const second = (await golden.runOne(smoke(), { outDir: out, ...quiet })) as Run;
    assert.equal(second.status, "submit_unconfirmed");
    assert.equal(mock.state.jobPosts.length, 2);
    assert.deepEqual(mock.state.jobPosts.map((p) => p.idempotencyKey), [first.idempotencyKey, first.idempotencyKey]);
    assert.equal(mock.state.jobPosts.filter((p) => p.jobId !== null).length, 1, "exactly one job created");
    await golden.runOne(smoke(), { outDir: out, ...quiet });
    assert.equal(mock.state.jobPosts.length, 2, "an unconfirmed record is final");
  });

  it("a failed job is recorded with its error", async () => {
    mock.setScenario("failed");
    const run = (await golden.runOne(smoke(), { outDir: out, ...quiet })) as Run & { error: unknown };
    assert.equal(run.status, "failed");
    assert.ok(run.error);
  });
});
