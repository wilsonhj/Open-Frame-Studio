import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PipelineRun, PlanContext } from "../../lib/pipeline/types.ts";
import { photoshootPipeline } from "../../lib/photoshoot/pipeline.ts";

const ctx: PlanContext = { runId: "run_1", now: "2026-10-30T00:00:00.000Z", randomSeed: () => 1000 };

describe("photoshoot validate", () => {
  const ok = { mode: "lifestyle_scene", prompt: "matte bottle", images: [{ upload: "product" }], count: 2 };

  it("accepts a product-only request", () => {
    const r = photoshootPipeline.validate(ok);
    assert.ok(r.ok);
    assert.equal(r.value.count, 2);
  });

  it("requires a product image", () => {
    assert.deepEqual(photoshootPipeline.validate({ ...ok, images: [] }), {
      ok: false,
      error: "a product image is required",
      field: "images",
    });
  });

  it("rejects unknown modes, bad counts and bad refs", () => {
    const mode = photoshootPipeline.validate({ ...ok, mode: "nope" });
    assert.ok(!mode.ok && mode.field === "mode");
    const count = photoshootPipeline.validate({ ...ok, count: 5 });
    assert.ok(!count.ok && count.field === "count");
    const carousel = photoshootPipeline.validate({ ...ok, mode: "social_carousel", count: 2 });
    assert.ok(!carousel.ok && carousel.field === "count");
    const ref = photoshootPipeline.validate({ ...ok, images: [{ url: "x" }] });
    assert.ok(!ref.ok && ref.field === "images[0]");
  });

  it("defaults count per mode and keeps an optional soulId", () => {
    const r = photoshootPipeline.validate({ mode: "social_carousel", images: [{ assetId: "a" }], soulId: "s1" });
    assert.ok(r.ok);
    assert.equal(r.value.count, 4);
    assert.equal(r.value.soulId, "s1");
  });
});

describe("photoshoot plan and result", () => {
  it("plans one cutout and N klein steps wired to it", async () => {
    const steps = await photoshootPipeline.plan(
      { mode: "hero_banner", prompt: "", images: [{ assetId: "asset_p" }], count: 3 },
      ctx,
    );
    assert.equal(steps.length, 4);
    const [cut, ...shots] = steps;
    assert.equal(cut.kind === "comfy" && cut.workflow, "cutout");
    assert.equal(cut.inputs.image, "asset_p");
    shots.forEach((s, i) => {
      assert.equal(s.kind === "comfy" && s.workflow, "klein_edit_multiref");
      assert.deepEqual(s.dependsOn, ["cutout"]);
      assert.deepEqual(s.inputs.image_1, { fromStep: "cutout", outputNode: "18" });
      assert.equal(s.inputs.seed, 1000 + i);
      assert.equal(s.inputs.width, 1280);
      assert.equal(s.inputs.height, 720);
      assert.equal(s.status, "pending");
      assert.ok(s.timeoutMs > 0);
    });
  });

  it("builds items from step outputs and surfaces errors", async () => {
    const request = { mode: "product_shot" as const, prompt: "", images: [{ assetId: "a" }], count: 2, soulId: "s" };
    const steps = await photoshootPipeline.plan(request, ctx);
    steps[0].status = "succeeded";
    steps[1].status = "succeeded";
    steps[1].outputs = [
      { id: "o1", jobId: "j1", nodeId: "9", name: "o.png", type: "image", contentType: "image/png", sizeBytes: 1, url: "/api/jobs/j1/outputs/o1" },
    ];
    steps[2].status = "failed";
    steps[2].error = { code: "content_moderated", message: "blocked" };
    const run = { kind: "photoshoot", request, steps } as unknown as PipelineRun<"photoshoot">;
    const result = await photoshootPipeline.buildResult(run);
    assert.equal(result.aspectRatio, "1:1");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].output?.url, "/api/jobs/j1/outputs/o1");
    assert.equal(result.items[1].error?.code, "content_moderated");
    assert.ok(result.items[0].variation.preset.length > 0);
    assert.ok(result.notices.some((n) => n.includes("Soul")));
  });

  it("retry replans one item with a new seed", async () => {
    const request = { mode: "product_shot" as const, prompt: "", images: [{ assetId: "a" }], count: 2 };
    const steps = await photoshootPipeline.plan(request, ctx);
    steps.forEach((s) => (s.status = "succeeded"));
    steps[2].status = "failed";
    const run = { kind: "photoshoot", request, steps } as unknown as PipelineRun<"photoshoot">;
    const retry = photoshootPipeline.actions!.retry;
    const res = await retry.run({
      run,
      params: { index: "1" },
      body: null,
      plan: { ...ctx, randomSeed: () => 777 },
    } as never);
    assert.equal(res.type, "replan");
    if (res.type !== "replan") return;
    assert.equal(res.steps[2].status, "pending");
    assert.equal(res.steps[2].inputs.seed, 777);
    assert.equal(res.steps[1], steps[1]);
  });
});
