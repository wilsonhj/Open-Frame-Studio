import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import sharp from "sharp";

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
  kind: "identity",
  validate(raw: unknown) {
    const r = raw as { photo?: unknown } | null;
    if (!r || typeof r.photo !== "object") return { ok: false, error: "photo is required", field: "photo" };
    return { ok: true, value: r as never };
  },
  async plan(request: unknown) {
    const { photo, planError } = request as { photo: { assetId: string }; planError?: string };
    if (planError === "identity") throw Object.assign(new Error("Soul x not found."), { name: "SoulNotFoundError" });
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
    const res = await runner.createRun("identity", {});
    assert.deepEqual(res, { ok: false, status: 400, error: "photo is required", field: "photo" });
  });

  it("runs a comfy step then a code step end to end and persists the run", async () => {
    runner.registerDefinition(fake);
    const uploads = new Map([["p", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]);
    const created = await runner.createRun("identity", { photo: { upload: "p" } }, uploads);
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
    assert.match(resize.outputs![0].url, new RegExp(`^/api/pipelines/identity/${id}/files/resize/0\\.png$`));
    assert.ok((measure.data as { size: number }).size > 0);
    assert.deepEqual(run.result, { measured: measure.data });

    assert.equal(measure.outputs![0].id, "measure/note.txt");
    assert.equal(measure.outputs![0].url, `/api/pipelines/identity/${id}/files/measure/note.txt`);
    const file = await store.readRunFile(id, "measure/note.txt");
    assert.equal(new TextDecoder().decode(file!), "ok");
  });

  it("marks dependents skipped when the comfy job fails", async () => {
    runner.registerDefinition(fake);
    await fetch(`${mock.url}/__mock/scenario`, { method: "POST", body: JSON.stringify({ scenario: "failed" }) });
    const created = await runner.createRun("identity", { photo: { upload: "p" } }, new Map([["p", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]));
    assert.ok(created.ok);
    await runner.whenIdle(created.run.id);
    const run = await store.loadRun(created.run.id);
    assert.equal(run!.status, "failed");
    assert.deepEqual(run!.steps.map((s) => s.status), ["failed", "skipped", "skipped", "skipped"]);
  });

  it("maps plan() errors to 404 identityId / status+field / 500", async () => {
    runner.registerDefinition(fake);
    const photo = { assetId: "a" };
    assert.deepEqual(await runner.createRun("identity", { photo, planError: "identity" }), { ok: false, status: 404, error: "Soul x not found.", field: "identityId" });
    assert.deepEqual(await runner.createRun("identity", { photo, planError: "field" }), { ok: false, status: 400, error: "bad mode", field: "mode" });
    assert.deepEqual(await runner.createRun("identity", { photo, planError: "other" }), { ok: false, status: 500, error: "boom" });
  });

  it("a shot still skipped after a retry fixed its failed cutout keeps the run from succeeded", async () => {
    const scenario = (body: object) => fetch(`${mock.url}/__mock/scenario`, { method: "POST", body: JSON.stringify(body) });
    await scenario({ scenario: "failed" });
    const uploads = new Map([["product", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]);
    const created = await runner.createRun("photoshoot", { mode: "packshot", images: [{ upload: "product" }], count: 2 }, uploads);
    assert.ok(created.ok);
    const id = created.run.id;
    await runner.whenIdle(id);
    assert.equal((await store.loadRun(id))!.status, "failed");

    // Retrying frame 0 re-runs the cutout and that frame; frame 1 stays skipped.
    await scenario({ scenario: "succeeded" });
    const retried = await runner.runAction("photoshoot", id, "POST", ["items", "0", "retry"], null);
    assert.equal(retried.type, "run");
    await runner.whenIdle(id);
    const run = (await store.loadRun(id))!;
    assert.deepEqual(run.steps.map((s) => s.status), ["succeeded", "succeeded", "skipped"]);
    assert.equal(run.status, "partial");
    await fetch(`${mock.url}/__mock/reset`, { method: "POST" });
  });

  it("a code step that skips on purpose does not keep the run from succeeded", async () => {
    runner.registerDefinition({
      ...fake,
      async plan(request: unknown) {
        const { photo } = request as { photo: { assetId: string } };
        return [
          { id: "resize", kind: "comfy", workflow: "image_resize_smoke", dependsOn: [], inputs: { image: photo.assetId, scale: 0.5 }, timeoutMs: 20_000, status: "pending" },
          { id: "optional", kind: "code", workflow: "optional", dependsOn: [], inputs: {}, timeoutMs: 10_000, status: "pending" },
        ];
      },
      handlers: { optional: async () => ({ status: "skipped" }) },
      async buildResult() {
        return {} as never;
      },
    } as unknown as AnyPipelineDefinition);
    const uploads = new Map([["p", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]);
    const created = await runner.createRun("identity", { photo: { upload: "p" } }, uploads);
    assert.ok(created.ok);
    await runner.whenIdle(created.run.id);
    const run = (await store.loadRun(created.run.id))!;
    assert.deepEqual(run.steps.map((s) => s.status), ["succeeded", "skipped"]);
    assert.equal(run.status, "succeeded");
  });

  // The mock echoes its input, so this cross is the cutout; `opaque` fills the rest of
  // the canvas, which the main-image compliance check rejects as an un-cut photo.
  async function runListing(opaque: boolean) {
    const w = 600;
    const px = Buffer.alloc(w * w * 4, opaque ? 255 : 0);
    for (let y = 50; y < 550; y++) for (let x = 200; x < 400; x++) px.set([30, 90, 160, 255], (y * w + x) * 4);
    for (let y = 250; y < 350; y++) for (let x = 20; x < 580; x++) px.set([30, 90, 160, 255], (y * w + x) * 4);
    const png = new Uint8Array(await sharp(px, { raw: { width: w, height: w, channels: 4 } }).png().toBuffer());
    const uploads = new Map([["product", { bytes: png, filename: "p.png", contentType: "image/png" }]]);
    const created = await runner.createRun("listing", { assets: ["gallery_callouts", "gallery_contents"], productImages: [{ upload: "product" }] }, uploads);
    assert.ok(created.ok);
    await runner.whenIdle(created.run.id);
    return (await store.loadRun(created.run.id))!;
  }

  it("a Listing run whose only other tiles need copy ends partial: the hero is a deliverable", async () => {
    const run = await runListing(false);
    assert.deepEqual(
      run.steps.map((s) => [s.id, s.status]),
      [
        ["cutout", "succeeded"],
        ["compose_main", "succeeded"],
        ["gallery_callouts", "needs_input"],
        ["gallery_contents", "needs_input"],
      ],
    );
    assert.equal(run.status, "partial");
  });

  it("a Listing run whose main image fails compliance still ends failed, copy gaps or not", async () => {
    const run = await runListing(true);
    assert.deepEqual(
      run.steps.map((s) => [s.id, s.status]),
      [
        ["cutout", "succeeded"],
        ["compose_main", "failed"],
        ["gallery_callouts", "skipped"],
        ["gallery_contents", "skipped"],
      ],
    );
    assert.equal(run.steps[1].error?.code, "main_not_compliant");
    assert.equal(run.status, "failed");
  });
});
