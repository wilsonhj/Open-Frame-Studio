import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { PNG_1X1, startMockComfy, type MockComfy } from "../mock-comfy/server.ts";
import type { AnyPipelineDefinition } from "../../lib/pipeline/types.ts";

let mock: MockComfy;
let dir: string;
let runner: typeof import("../../lib/pipeline/runner.ts");
let store: typeof import("../../lib/store.ts");

before(async () => {
  mock = await startMockComfy();
  dir = await mkdtemp(join(tmpdir(), "oss-runs-"));
  process.env.COMFY_BASE_URL = mock.url;
  process.env.COMFY_API_KEY = "test-key";
  process.env.DATA_DIR = dir;
  runner = await import("../../lib/pipeline/runner.ts");
  store = await import("../../lib/store.ts");
});

after(async () => {
  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

const fake = {
  kind: "soul",
  validate(raw: unknown) {
    const r = raw as { photo?: unknown } | null;
    if (!r || typeof r.photo !== "object") return { ok: false, error: "photo is required", field: "photo" };
    return { ok: true, value: r as never };
  },
  async plan(request: unknown) {
    const { photo, planError } = request as { photo: { assetId: string }; planError?: string };
    if (planError === "soul") throw Object.assign(new Error("Soul x not found."), { name: "SoulNotFoundError" });
    if (planError === "field") throw Object.assign(new Error("bad mode"), { status: 400, field: "mode" });
    if (planError === "other") throw new Error("boom");
    return [
      {
        id: "resize",
        kind: "comfy",
        workflow: "image_resize_smoke",
        dependsOn: [],
        inputs: { image: photo.assetId, scale: 0.5 },
        timeoutMs: 20_000,
        status: "pending",
      },
      {
        id: "rescale",
        kind: "comfy",
        workflow: "image_resize_smoke",
        dependsOn: ["measure"],
        inputs: { image: { fromStep: "measure", outputNode: "note.txt" }, scale: 2 },
        timeoutMs: 20_000,
        status: "pending",
      },
      {
        id: "missing",
        kind: "comfy",
        workflow: "image_resize_smoke",
        dependsOn: ["measure"],
        inputs: { image: { fromStep: "measure", outputNode: "nope.png" } },
        timeoutMs: 20_000,
        status: "pending",
      },
      {
        id: "measure",
        kind: "code",
        workflow: "measure",
        dependsOn: ["resize"],
        inputs: { source: { fromStep: "resize", outputNode: "image" } },
        timeoutMs: 10_000,
        status: "pending",
      },
    ];
  },
  handlers: {
    async measure(ctx: { readBytes: (s: unknown) => Promise<Uint8Array>; step: { inputs: Record<string, unknown> } }) {
      const bytes = await ctx.readBytes(ctx.step.inputs.source);
      return { data: { size: bytes.byteLength }, files: [{ name: "note.txt", contentType: "text/plain", bytes: new TextEncoder().encode("ok") }] };
    },
  },
  async buildResult(run: { steps: { data?: unknown }[] }) {
    return { measured: run.steps.at(-1)!.data } as never;
  },
} as unknown as AnyPipelineDefinition;

describe("pipeline runner", () => {
  it("rejects an invalid request before any upload", async () => {
    runner.registerDefinition(fake);
    const res = await runner.createRun("soul", {});
    assert.deepEqual(res, { ok: false, status: 400, error: "photo is required", field: "photo" });
  });

  it("runs a comfy step then a code step end to end and persists the run", async () => {
    runner.registerDefinition(fake);
    const uploads = new Map([["p", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]);
    const created = await runner.createRun("soul", { photo: { upload: "p" } }, uploads);
    assert.ok(created.ok);
    const id = created.run.id;
    assert.ok("assetId" in (created.run.request as unknown as { photo: object }).photo);
    await runner.whenIdle(id);

    const run = await store.loadRun(id);
    assert.ok(run);
    const by = Object.fromEntries(run.steps.map((s) => [s.id, s]));
    const { resize, measure, rescale, missing } = by;
    // `missing` (a leaf) failed, `rescale` (a leaf) succeeded: a deliverable exists.
    assert.equal(run.status, "partial", JSON.stringify(run.steps.map((s) => [s.id, s.status, s.error])));
    assert.equal(run.progress, 1);
    assert.equal(rescale.status, "succeeded");
    assert.equal(missing.status, "failed");
    assert.equal(missing.error?.code, "input_missing");
    assert.equal(resize.kind, "comfy");
    assert.equal(resize.kind === "comfy" && resize.submission?.state, "accepted");
    assert.ok(resize.kind === "comfy" && resize.jobId);
    assert.match(resize.outputs![0].url, new RegExp(`^/api/pipelines/soul/${id}/files/resize/0\\.png$`));
    assert.ok((measure.data as { size: number }).size > 0);
    assert.deepEqual(run.result, { measured: measure.data });

    assert.equal(measure.outputs![0].id, "measure/note.txt");
    assert.equal(measure.outputs![0].url, `/api/pipelines/soul/${id}/files/measure/note.txt`);
    const file = await store.readRunFile(id, "measure/note.txt");
    assert.equal(new TextDecoder().decode(file!), "ok");
  });

  it("marks dependents skipped when the comfy job fails", async () => {
    runner.registerDefinition(fake);
    await fetch(`${mock.url}/__mock/scenario`, { method: "POST", body: JSON.stringify({ scenario: "failed" }) });
    const created = await runner.createRun("soul", { photo: { upload: "p" } }, new Map([["p", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]));
    assert.ok(created.ok);
    await runner.whenIdle(created.run.id);
    const run = await store.loadRun(created.run.id);
    assert.equal(run!.status, "failed");
    assert.deepEqual(run!.steps.map((s) => s.status), ["failed", "skipped", "skipped", "skipped"]);
  });

  it("maps plan() errors to 404 soulId / status+field / 500", async () => {
    runner.registerDefinition(fake);
    const photo = { assetId: "a" };
    assert.deepEqual(await runner.createRun("soul", { photo, planError: "soul" }), { ok: false, status: 404, error: "Soul x not found.", field: "soulId" });
    assert.deepEqual(await runner.createRun("soul", { photo, planError: "field" }), { ok: false, status: 400, error: "bad mode", field: "mode" });
    assert.deepEqual(await runner.createRun("soul", { photo, planError: "other" }), { ok: false, status: 500, error: "boom" });
  });
});
