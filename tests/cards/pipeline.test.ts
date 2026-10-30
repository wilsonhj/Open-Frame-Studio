import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { cardsPipeline } from "../../lib/cards/pipeline.ts";
import type { CodePipelineStep, PipelineRun } from "../../lib/types.ts";
import { CARD_ASSETS, RUN_SCHEMA } from "../../lib/types.ts";

const planCtx = { runId: "run_1", now: "2026-10-30T00:00:00Z", randomSeed: () => 1 };

async function cutoutPng(): Promise<Uint8Array> {
  const w = 600;
  const data = Buffer.alloc(w * w * 4);
  for (let y = 50; y < 550; y++) {
    for (let x = 200; x < 400; x++) {
      const i = (y * w + x) * 4;
      data.set([30, 90, 160, 255], i);
    }
  }
  // A cross shape, so the bbox has real transparency
  for (let y = 250; y < 350; y++) {
    for (let x = 20; x < 580; x++) data.set([30, 90, 160, 255], (y * w + x) * 4);
  }
  return new Uint8Array(await sharp(data, { raw: { width: w, height: w, channels: 4 } }).png().toBuffer());
}

describe("cardsPipeline", () => {
  it("validates productImages", () => {
    assert.equal(cardsPipeline.validate({}).ok, false);
    const bad = cardsPipeline.validate({ productImages: [{ nope: 1 }] });
    assert.ok(!bad.ok && bad.field === "productImages[0]");
    const good = cardsPipeline.validate({ productImages: [{ upload: "product" }], productName: " Serum " });
    assert.ok(good.ok && good.value.productName === "Serum" && good.value.scope === "hero");
    const reuse = cardsPipeline.validate({ productImages: [{ assetId: "a" }], mainJobId: "run_0" });
    assert.ok(!reuse.ok && reuse.field === "mainJobId");
  });

  it("plans cutout -> compose_main and builds a main result", async () => {
    const request = { scope: "hero" as const, productImages: [{ assetId: "asset_hero" }] };
    const steps = await cardsPipeline.plan(request, planCtx);
    assert.deepEqual(
      steps.map((s) => [s.id, s.kind, s.dependsOn]),
      [
        ["cutout", "comfy", []],
        ["compose_main", "code", ["cutout"]],
      ],
    );
    assert.equal(steps[0].inputs.image, "asset_hero");

    const bytes = await cutoutPng();
    const run: PipelineRun<"listing"> = {
      schema: RUN_SCHEMA,
      id: "run_1",
      kind: "listing",
      status: "running",
      createdAt: planCtx.now,
      updatedAt: planCtx.now,
      timeoutMs: 1,
      progress: 0,
      steps,
      request,
      result: null,
      error: null,
    };
    const compose = steps[1] as CodePipelineStep;
    const out = await cardsPipeline.handlers.compose_main({
      run,
      step: compose,
      readBytes: async (src) => {
        assert.deepEqual(src, { fromStep: "cutout", outputNode: "cutout" });
        return bytes;
      },
      uploadAsset: async () => "unused",
      signal: new AbortController().signal,
    });
    assert.equal(out.files?.[0].name, "01_hero.png");
    assert.equal(out.status, "succeeded");

    steps[0] = { ...steps[0], status: "succeeded", jobId: "job_1" } as typeof steps[0];
    steps[1] = {
      ...compose,
      status: "succeeded",
      data: out.data,
      outputs: [
        {
          id: "01_hero.png",
          jobId: "",
          nodeId: "",
          name: "01_hero.png",
          type: "image",
          contentType: "image/png",
          sizeBytes: 1,
          url: "/api/pipelines/listing/run_1/files/01_hero.png",
        },
      ],
    };
    const result = await cardsPipeline.buildResult({ ...run, status: "succeeded" });
    assert.ok(result.main?.ok, JSON.stringify(result.main?.checks));
    assert.equal(result.main?.compositeUrl, "/api/pipelines/listing/run_1/files/01_hero.png");
    assert.equal(result.tiles.length, CARD_ASSETS.length);
    assert.equal(result.tiles[0].state, "succeeded");
    assert.ok(result.tiles.slice(1).every((t) => t.state === "skipped"));
  });

  it("a failed cutout shows on the hero tile with its reason, not as a bare skip", async () => {
    const request = { scope: "hero" as const, productImages: [{ assetId: "asset_hero" }] };
    const [cut, compose] = await cardsPipeline.plan(request, planCtx);
    const reason = { code: "node_execution_error", message: "background removal failed" };
    const run: PipelineRun<"listing"> = {
      schema: RUN_SCHEMA,
      id: "run_2",
      kind: "listing",
      status: "failed",
      createdAt: planCtx.now,
      updatedAt: planCtx.now,
      timeoutMs: 1,
      progress: 1,
      steps: [
        { ...cut, status: "failed", error: reason } as typeof cut,
        { ...compose, status: "skipped" } as typeof compose,
      ],
      request,
      result: null,
      error: null,
    };
    const result = await cardsPipeline.buildResult(run);
    assert.equal(result.tiles[0].state, "failed");
    assert.deepEqual(result.tiles[0].error, reason);
  });

  it("names the entry an error is in when the request has lists", () => {
    const base = { productImages: [{ upload: "product" }], scope: "complete" as const };
    const cases: [Record<string, unknown>, string, string][] = [
      [{ painPoints: [{ problem: "a", solution: "b" }, { problem: "c" }] }, "painPoints[1].solution", "Problem 2: solution is required"],
      [{ bullets: ["a", "b", "x".repeat(91)] }, "bullets[2]", "Benefit 3: "],
      [{ howToUse: ["a", ""] }, "howToUse[1]", "Step 2: "],
      [{ specs: [{ label: "Volume" }] }, "specs[0].value", "Spec 1: value is required"],
      [{ ingredients: [{ name: "a" }, { benefit: "b" }] }, "ingredients[1].name", "Ingredient 2: name is required"],
      [{ boxContents: [{ qty: 0, name: "a" }] }, "boxContents[0].qty", "Box item 1: "],
      [{ efficacySource: "S", efficacyClaims: [{ value: "1", label: "a" }, { value: "2" }] }, "efficacyClaims[1].label", "Result 2: label is required"],
      [{ brandColors: ["#000000", "red"] }, "brandColors[1]", "Colour 2: "],
    ];
    for (const [extra, field, prefix] of cases) {
      const res = cardsPipeline.validate({ ...base, ...extra });
      assert.ok(!res.ok, field);
      assert.equal(res.field, field);
      assert.ok(res.error.startsWith(prefix), `${field}: ${res.error}`);
    }
    // A whole-list error has no entry to name.
    const count = cardsPipeline.validate({ ...base, bullets: ["a"] });
    assert.ok(!count.ok && count.error === "bullets needs 3–5 entries" && count.field === "bullets");
  });
});
