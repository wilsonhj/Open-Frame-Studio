import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PipelineRun, PlanContext } from "../../lib/pipeline/types.ts";
import { photoshootPipeline, resolveAspect, resolveCount } from "../../lib/photoshoot/pipeline.ts";

const ctx: PlanContext = { runId: "run_1", now: "2026-10-30T00:00:00.000Z", randomSeed: () => 1000 };

describe("photoshoot validate", () => {
  const ok = { mode: "in_context", prompt: "matte bottle", images: [{ upload: "product" }], count: 2 };

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

  it("rejects unknown modes, non-integer counts, malformed ratios and bad refs", () => {
    const mode = photoshootPipeline.validate({ ...ok, mode: "nope" });
    assert.ok(!mode.ok && mode.field === "mode");
    const count = photoshootPipeline.validate({ ...ok, count: 2.5 });
    assert.ok(!count.ok && count.field === "count");
    const ratio = photoshootPipeline.validate({ ...ok, aspectRatio: "wide" });
    assert.ok(!ratio.ok && ratio.field === "aspectRatio");
    const ref = photoshootPipeline.validate({ ...ok, images: [{ url: "x" }] });
    assert.ok(!ref.ok && ref.field === "images[0]");
  });

  it("clamps the count and snaps the ratio with notices (acceptance #20, #21)", async () => {
    // #20: a "2-slide carousel" becomes 3 slides, with a notice.
    const carousel = photoshootPipeline.validate({ ...ok, images: [{ assetId: "a" }], mode: "carousel_set", count: 2 });
    assert.ok(carousel.ok);
    const carouselSteps = await photoshootPipeline.plan(carousel.value, ctx);
    assert.equal(carouselSteps.length, 1 + 3);
    const carouselResult = await photoshootPipeline.buildResult({
      kind: "photoshoot",
      request: carousel.value,
      steps: carouselSteps,
    } as unknown as PipelineRun<"photoshoot">);
    assert.equal(carouselResult.count, 3);
    assert.ok(carouselResult.notices.some((n) => n.includes("Asked for 2")));

    // #21: a hero banner at 21:9 snaps to 16:9, with a notice.
    const banner = photoshootPipeline.validate({ ...ok, images: [{ assetId: "a" }], mode: "wide_banner", aspectRatio: "21:9", count: 1 });
    assert.ok(banner.ok);
    const bannerResult = await photoshootPipeline.buildResult({
      kind: "photoshoot",
      request: banner.value,
      steps: await photoshootPipeline.plan(banner.value, ctx),
    } as unknown as PipelineRun<"photoshoot">);
    assert.equal(bannerResult.aspectRatio, "16:9");
    assert.ok(bannerResult.notices.some((n) => n.includes("21:9") && n.includes("16:9")));

    // An offered-elsewhere ratio snaps to the nearest one this mode offers, not the default.
    assert.deepEqual(resolveAspect({ ...ok, mode: "packshot", aspectRatio: "5:4" } as never), { aspect: "4:3", snapped: true });
    assert.deepEqual(resolveCount({ ...ok, mode: "packshot", count: 6 } as never), { count: 4, clamped: true });
  });

  it("defaults count per mode and keeps an optional identityId", () => {
    const r = photoshootPipeline.validate({ mode: "carousel_set", images: [{ assetId: "a" }], identityId: "s1" });
    assert.ok(r.ok);
    assert.equal(r.value.count, 4);
    assert.equal(r.value.identityId, "s1");
  });
});

describe("photoshoot plan and result", () => {
  it("plans one cutout and N klein steps wired to it", async () => {
    const steps = await photoshootPipeline.plan(
      { mode: "wide_banner", prompt: "", images: [{ assetId: "asset_p" }], count: 3 },
      ctx,
    );
    assert.equal(steps.length, 4);
    const [cut, ...shots] = steps;
    assert.equal(cut.kind === "comfy" && cut.workflow, "cutout");
    assert.equal(cut.inputs.image, "asset_p");
    shots.forEach((s, i) => {
      assert.equal(s.kind === "comfy" && s.workflow, "klein_edit_multiref");
      assert.deepEqual(s.dependsOn, ["cutout"]);
      assert.deepEqual(s.inputs.image_1, { fromStep: "cutout", outputNode: "cutout" });
      assert.equal(s.inputs.seed, 1000 + i);
      assert.equal(s.inputs.width, 1280);
      assert.equal(s.inputs.height, 720);
      assert.equal(s.status, "pending");
      assert.ok(s.timeoutMs > 0);
    });
  });

  it("builds items from step outputs and surfaces errors", async () => {
    const request = { mode: "packshot" as const, prompt: "", images: [{ assetId: "a" }], count: 2, identityId: "s" };
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
    assert.ok(result.notices.some((n) => n.includes("Identity ignored")));
  });

  it("retry replans one item with a new seed", async () => {
    const request = { mode: "packshot" as const, prompt: "", images: [{ assetId: "a" }], count: 2 };
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
    assert.equal(res.steps[2].kind === "comfy" && res.steps[2].jobId, undefined);
  });

  it("retry answers 409 while the item is still running", async () => {
    const request = { mode: "packshot" as const, prompt: "", images: [{ assetId: "a" }], count: 1 };
    const steps = await photoshootPipeline.plan(request, ctx);
    steps[1].status = "running";
    const run = { kind: "photoshoot", request, steps } as unknown as PipelineRun<"photoshoot">;
    const res = await photoshootPipeline.actions!.retry.run({ run, params: { index: "0" }, body: null, plan: ctx } as never);
    assert.equal(res.type === "error" && res.status, 409);
  });

  it("retrying a second frame while the restarted cutout runs leaves the cutout alone", async () => {
    const request = { mode: "packshot" as const, prompt: "", images: [{ assetId: "a" }], count: 2 };
    const steps = await photoshootPipeline.plan(request, ctx);
    steps[0].status = "running"; // restarted by an earlier frame retry
    steps[1].status = "pending";
    steps[2].status = "skipped";
    const run = { kind: "photoshoot", request, steps } as unknown as PipelineRun<"photoshoot">;
    const res = await photoshootPipeline.actions!.retry.run({ run, params: { index: "1" }, body: null, plan: ctx } as never);
    assert.equal(res.type, "replan");
    if (res.type !== "replan") return;
    assert.equal(res.steps[0], steps[0], "the running cutout is not reset");
    assert.equal(res.steps[2].status, "pending");
  });
});
