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
    const { photo } = request as { photo: { assetId: string } };
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
        id: "measure",
        kind: "code",
        workflow: "measure",
        dependsOn: ["resize"],
        inputs: { source: { fromStep: "resize" } },
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
    return { measured: run.steps[1].data } as never;
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
    assert.equal(run.status, "succeeded", JSON.stringify(run.steps.map((s) => [s.id, s.status, s.error])));
    assert.equal(run.progress, 1);
    const [resize, measure] = run.steps;
    assert.equal(resize.kind, "comfy");
    assert.equal(resize.kind === "comfy" && resize.submission?.state, "accepted");
    assert.ok(resize.kind === "comfy" && resize.jobId);
    assert.match(resize.outputs![0].url, new RegExp(`^/api/pipelines/soul/${id}/files/`));
    assert.ok((measure.data as { size: number }).size > 0);
    assert.deepEqual(run.result, { measured: measure.data });

    const name = decodeURIComponent(measure.outputs![0].url.split("/").pop()!);
    const file = await store.readRunFile(id, name);
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
    assert.deepEqual(run!.steps.map((s) => s.status), ["failed", "skipped"]);
  });
});
