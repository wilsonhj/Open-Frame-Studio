import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { cardsPipeline } from "../../lib/cards/pipeline.ts";
import { unzipStore, zipStore } from "../../lib/cards/zip.ts";
import type { ActionContext } from "../../lib/pipeline/types.ts";
import type { CardsRequest, CodePipelineStep, OutputRef, PipelineRun, PipelineStep, StepInputRef } from "../../lib/types.ts";
import { CARD_ASSETS, RUN_SCHEMA } from "../../lib/types.ts";

let seedCounter = 1000;
const planCtx = { runId: "run_p", now: "2026-10-30T00:00:00Z", randomSeed: () => seedCounter++ };

const FULL: CardsRequest = {
  scope: "complete",
  productImages: [{ assetId: "asset_hero" }],
  productName: "Hydra Serum",
  brandName: "Aster",
  bullets: ["Hydrates for 24 hours", "Fragrance free", "Dermatologist tested"],
  specs: [{ label: "Volume", value: "30 ml" }],
  boxContents: [{ qty: 1, name: "Serum bottle" }],
  painPoints: [
    { problem: "Dry skin", solution: "Lasting hydration" },
    { problem: "Dull skin", solution: "Visible glow" },
  ],
  efficacyClaims: [{ value: "92%", label: "felt more hydrated" }, { value: "24h", label: "moisture" }],
  efficacySource: "Consumer test, 50 women, 4 weeks",
  howToUse: ["Cleanse", "Apply 3 drops"],
  endorsement: { type: "review", text: "So soft.", by: "Maya", rightsConfirmed: true },
  seed: 42,
};

async function png(w: number, h: number, rgb: [number, number, number], alpha = 1): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }).png().toBuffer(),
  );
}

/** A cutout with transparent margins around a solid product. */
async function cutout(): Promise<Uint8Array> {
  const w = 600;
  const data = Buffer.alloc(w * w * 4);
  for (let y = 60; y < 540; y++) for (let x = 180; x < 420; x++) data.set([30, 90, 160, 255], (y * w + x) * 4);
  return new Uint8Array(await sharp(data, { raw: { width: w, height: w, channels: 4 } }).png().toBuffer());
}

function runOf(request: CardsRequest, steps: PipelineStep[]): PipelineRun<"listing"> {
  return {
    schema: RUN_SCHEMA,
    id: "run_p",
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
}

function output(stepId: string, name: string): OutputRef {
  return {
    id: `${stepId}/${name}`,
    jobId: "",
    nodeId: "",
    name,
    type: "image",
    contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
    sizeBytes: 1,
    url: `/api/pipelines/listing/run_p/files/${stepId}/${name}`,
  };
}

describe("listing validate (§7, R-S4, T-S3, T-T1, T-T4)", () => {
  it("accepts a complete request and defaults to the hero scope", () => {
    const r = cardsPipeline.validate(FULL);
    assert.ok(r.ok, JSON.stringify(r));
    const bare = cardsPipeline.validate({ productImages: [{ upload: "p" }] });
    assert.ok(bare.ok && bare.value.scope === "hero");
  });

  it("rejects unknown asset ids, listing the valid ones", () => {
    const r = cardsPipeline.validate({ productImages: [{ upload: "p" }], assets: ["hero", "aplus_banner"] });
    assert.ok(!r.ok);
    assert.equal(r.field, "assets[1]");
    for (const id of CARD_ASSETS) assert.ok(r.error.includes(id));
  });

  it("rejects a 200-character bullet by field (no silent truncation)", () => {
    const r = cardsPipeline.validate({ ...FULL, bullets: ["a", "b", "x".repeat(200)] });
    assert.ok(!r.ok && r.field === "bullets[2]");
  });

  it("refuses efficacy claims without a source", () => {
    const { efficacySource: _drop, ...rest } = FULL;
    void _drop;
    const r = cardsPipeline.validate(rest);
    assert.ok(!r.ok && r.field === "efficacySource");
  });

  it("checks scope, colours and endorsement shape", () => {
    assert.equal(cardsPipeline.validate({ ...FULL, scope: "main" }).ok, false);
    const c = cardsPipeline.validate({ ...FULL, brandColors: ["blue"] });
    assert.ok(!c.ok && c.field === "brandColors[0]");
    const e = cardsPipeline.validate({ ...FULL, endorsement: { type: "fan", text: "x", by: "y", rightsConfirmed: true } });
    assert.ok(!e.ok && e.field === "endorsement.type");
  });
});

describe("listing plan", () => {
  it("fans every asset out after compose_main, with the anchor as image 1 on every Klein edit (T-A1)", async () => {
    const steps = await cardsPipeline.plan(FULL, planCtx);
    const renders = steps.filter((s) => s.kind === "code" && s.workflow === "render_card");
    assert.deepEqual(
      renders.map((s) => s.id),
      CARD_ASSETS.filter((a) => a !== "hero"),
    );
    for (const s of steps) {
      if (s.id === "cutout" || s.id === "compose_main") continue;
      if (s.workflow === "upscale") continue;
      assert.ok(s.dependsOn.includes("compose_main"), `${s.id} must wait for the hero`);
    }
    const edits = steps.filter((s) => s.workflow === "klein_edit_multiref");
    assert.ok(edits.length >= 6);
    for (const s of edits) assert.deepEqual(s.inputs.image_1, { fromStep: "cutout", outputNode: "cutout" });
    // Full-bleed square diffusion goes through SeedVR2 ×2 before the card is drawn (G4).
    const up = steps.find((s) => s.id === "gallery_detail_up");
    assert.equal(up?.workflow, "upscale");
    assert.deepEqual(steps.find((s) => s.id === "gallery_detail")?.inputs.g0, { fromStep: "gallery_detail_up", outputNode: "image" });
    // Story panels are drawn at 1464×600, below their 1472×608 generation: no upscale is billed.
    assert.deepEqual(
      steps.filter((s) => s.workflow === "upscale").map((s) => s.id),
      ["gallery_detail_up", "gallery_in_use_up", "gallery_contents_up"],
    );
    assert.deepEqual(steps.find((s) => s.id === "story_banner")?.inputs.g0, { fromStep: "story_banner_gen", outputNode: "image" });
    // Three generated views for gallery_angles when no extra photos were uploaded.
    assert.equal(steps.filter((s) => s.id.startsWith("gallery_angles_gen_")).length, 3);
    // No prompt ever asks for text (G1).
    for (const s of steps) if (typeof s.inputs.prompt === "string") assert.match(s.inputs.prompt, /No text/);
  });

  it("is deterministic for a given seed, and every diffusion seed differs", async () => {
    const a = await cardsPipeline.plan(FULL, planCtx);
    const b = await cardsPipeline.plan(FULL, planCtx);
    assert.deepEqual(a, b);
    const seeds = a.filter((s) => s.kind === "comfy" && s.workflow !== "upscale" && s.workflow !== "cutout").map((s) => s.inputs.seed);
    assert.equal(new Set(seeds).size, seeds.length);
  });

  it("cuts out uploaded extra angles and generates only the cells they leave empty", async () => {
    const angles = async (extra: string[]) => {
      const steps = await cardsPipeline.plan({ ...FULL, assets: ["gallery_angles"], productImages: [{ assetId: "h" }, ...extra.map((assetId) => ({ assetId }))] }, planCtx);
      const render = steps.find((s) => s.id === "gallery_angles")!;
      // The 2×2 grid: the anchor plus three sources, one per remaining cell.
      assert.equal(Object.keys(render.inputs).filter((k) => /^g\d$/.test(k)).length, 3);
      return steps.filter((s) => s.id.startsWith("gallery_angles_")).map((s) => [s.id, s.workflow, s.inputs.image ?? null]);
    };
    assert.deepEqual(await angles(["side", "back"]), [
      ["gallery_angles_cut_1", "cutout", "side"],
      ["gallery_angles_cut_2", "cutout", "back"],
      ["gallery_angles_gen", "klein_edit_multiref", null],
    ]);
    assert.deepEqual(await angles(["side"]), [
      ["gallery_angles_cut_1", "cutout", "side"],
      ["gallery_angles_gen_1", "klein_edit_multiref", null],
      ["gallery_angles_gen_2", "klein_edit_multiref", null],
    ]);
    assert.deepEqual(await angles(["a", "b", "c"]), [
      ["gallery_angles_cut_1", "cutout", "a"],
      ["gallery_angles_cut_2", "cutout", "b"],
      ["gallery_angles_cut_3", "cutout", "c"],
    ]);
  });

  it("plans no diffusion for an asset whose copy is missing (G7)", async () => {
    const request: CardsRequest = { scope: "story", productImages: [{ assetId: "h" }], productName: "Serum" };
    const steps = await cardsPipeline.plan(request, planCtx);
    assert.equal(steps.some((s) => s.id.startsWith("story_problem_solution_")), false);
    assert.ok(steps.some((s) => s.id === "story_problem_solution"));
    assert.ok(steps.some((s) => s.id === "story_banner_gen"));
  });
});

describe("render_card handler", () => {
  it("draws a card from the anchor and the generated image", async () => {
    const steps = await cardsPipeline.plan({ ...FULL, assets: ["story_banner"] }, planCtx);
    const render = steps.find((s) => s.id === "story_banner") as CodePipelineStep;
    const anchor = await cutout();
    const scene = await png(2944, 1216, [200, 180, 160]);
    const reads: StepInputRef[] = [];
    const out = await cardsPipeline.handlers.render_card({
      run: runOf({ ...FULL, assets: ["story_banner"] }, steps),
      step: render,
      readBytes: async (src) => {
        reads.push(src as StepInputRef);
        return (src as StepInputRef).fromStep === "cutout" ? anchor : scene;
      },
      uploadAsset: async () => "unused",
      signal: new AbortController().signal,
    });
    assert.equal(out.status, undefined);
    assert.equal(out.files?.[0].name, "07_story_banner.jpg");
    const meta = await sharp(Buffer.from(out.files![0].bytes)).metadata();
    assert.deepEqual([meta.width, meta.height, meta.channels], [1464, 600, 3]);
    assert.deepEqual(reads.map((r) => r.fromStep), ["cutout", "story_banner_gen"]);
  });

  it("ends needs_input and names the missing fields, instead of inventing copy (T-T3)", async () => {
    const request: CardsRequest = { scope: "complete", productImages: [{ assetId: "h" }], productName: "Serum", bullets: ["a", "b", "c"] };
    const steps = await cardsPipeline.plan(request, planCtx);
    const run = runOf(request, steps);
    const needs: string[] = [];
    for (const s of steps.filter((x) => x.kind === "code" && x.workflow === "render_card") as CodePipelineStep[]) {
      const out = await cardsPipeline.handlers.render_card({
        run,
        step: s,
        readBytes: async () => {
          throw new Error("needs_input must not read any bytes");
        },
        uploadAsset: async () => "unused",
        signal: new AbortController().signal,
      }).catch(() => ({ status: "drawn" as const }));
      if (out.status === "needs_input") needs.push(s.id);
    }
    assert.deepEqual(needs, ["gallery_contents", "story_problem_solution", "story_materials", "story_results", "story_how_to", "story_social_proof"]);
  });
});

describe("result and actions", () => {
  async function finishedRun(): Promise<{ run: PipelineRun<"listing">; files: Map<string, Uint8Array> }> {
    const request: CardsRequest = { ...FULL, scope: undefined, assets: ["gallery_callouts", "gallery_in_use", "story_results"] };
    const steps = await cardsPipeline.plan(request, planCtx);
    const files = new Map<string, Uint8Array>();
    const done = steps.map((s) => {
      const base = { ...s, status: "succeeded" as const };
      if (s.id === "compose_main") {
        files.set("compose_main", new Uint8Array([1]));
        return { ...base, outputs: [output("compose_main", "01_hero.png")], data: { checks: [], ok: true, cutoutBbox: { x: 0, y: 0, width: 1, height: 1 } } };
      }
      if (s.kind === "code") {
        files.set(s.id, new Uint8Array([2, s.id.length]));
        return { ...base, outputs: [output(s.id, `${s.id}.bin`)] };
      }
      return { ...base, jobId: `job_${s.id}` };
    }) as PipelineStep[];
    // story_results needs nothing more; mark it needs_input to check the gap path.
    const results = done.find((s) => s.id === "story_results")!;
    results.status = "needs_input";
    results.outputs = [];
    results.data = { asset: "story_results", missing: ["efficacySource"] };
    return { run: runOf(request, done), files };
  }

  function actionCtx(run: PipelineRun<"listing">, files: Map<string, Uint8Array>, params: Record<string, string> = {}): ActionContext<"listing"> {
    return {
      run,
      params,
      body: null,
      plan: planCtx,
      readBytes: async (src) => {
        const id = (src as StepInputRef).fromStep;
        const bytes = files.get(id);
        if (!bytes) throw new Error(`no file for ${id}`);
        return bytes;
      },
      uploadAsset: async () => "unused",
      signal: new AbortController().signal,
    };
  }

  it("builds tiles with seeds, URLs and gaps", async () => {
    const { run } = await finishedRun();
    const result = await cardsPipeline.buildResult(run);
    assert.deepEqual(result.assets, ["hero", "gallery_callouts", "gallery_in_use", "story_results"]);
    const byId = Object.fromEntries(result.tiles.map((t) => [t.asset, t]));
    assert.equal(byId.gallery_in_use.state, "succeeded");
    assert.equal(byId.gallery_in_use.seed, run.steps.find((s) => s.id === "gallery_in_use_gen")?.inputs.seed);
    assert.match(byId.gallery_callouts.url ?? "", /gallery_callouts/);
    assert.equal(byId.story_results.state, "needs_input");
    assert.deepEqual(byId.story_results.missing, ["efficacySource"]);
    assert.equal(byId.story_banner.state, "skipped");
    assert.match(result.styleBlock, /^Style:/);
  });

  it("regenerate changes only that tile's seed; anchor, styleBlock and other steps are kept (T-A2)", async () => {
    const { run, files } = await finishedRun();
    const res = await cardsPipeline.actions!.regenerate.run(actionCtx(run, files, { assetId: "gallery_in_use" }));
    assert.equal(res.type, "replan");
    if (res.type !== "replan") return;
    const before = new Map(run.steps.map((s) => [s.id, s]));
    for (const s of res.steps) {
      const old = before.get(s.id)!;
      if (s.id.startsWith("gallery_in_use")) {
        assert.equal(s.status, "pending");
        assert.equal(s.jobId, undefined);
        const { seed: a, ...restNew } = s.inputs;
        const { seed: b, ...restOld } = old.inputs;
        assert.deepEqual(restNew, restOld, `${s.id}: only the seed may change`);
        if (s.id === "gallery_in_use_gen") assert.notEqual(a, b);
      } else {
        assert.deepEqual(s, old, `${s.id} must be untouched`);
      }
    }
    assert.equal(res.steps.length, run.steps.length);
    const after = await cardsPipeline.buildResult({ ...run, steps: res.steps });
    assert.equal(after.styleBlock, (await cardsPipeline.buildResult(run)).styleBlock);
  });

  it("refuses to regenerate the hero, an unknown tile or one still running", async () => {
    const { run, files } = await finishedRun();
    const hero = await cardsPipeline.actions!.regenerate.run(actionCtx(run, files, { assetId: "hero" }));
    assert.ok(hero.type === "error" && hero.status === 400);
    const missing = await cardsPipeline.actions!.regenerate.run(actionCtx(run, files, { assetId: "story_banner" }));
    assert.ok(missing.type === "error" && missing.status === 404);
    const live = { ...run, steps: run.steps.map((s) => (s.id === "gallery_in_use_up" ? { ...s, status: "running" as const } : s)) };
    const busy = await cardsPipeline.actions!.regenerate.run(actionCtx(live, files, { assetId: "gallery_in_use" }));
    assert.ok(busy.type === "error" && busy.status === 409);
  });

  /** Every step of `request`'s plan succeeded (the board's view after a run). */
  async function succeeded(request: CardsRequest): Promise<PipelineRun<"listing">> {
    const steps = (await cardsPipeline.plan(request, planCtx)).map((s) =>
      s.id === "compose_main"
        ? { ...s, status: "succeeded" as const, data: { checks: [], ok: true, cutoutBbox: { x: 0, y: 0, width: 1, height: 1 } } }
        : { ...s, status: "succeeded" as const, ...(s.kind === "comfy" ? { jobId: `job_${s.id}` } : {}) },
    ) as PipelineStep[];
    return runOf(request, steps);
  }

  it("refuses a regenerate that can't change the card: copy too long, or no seeded image", async () => {
    const files = new Map<string, Uint8Array>();
    const run = await succeeded({ ...FULL, scope: undefined, assets: ["gallery_callouts", "gallery_angles"], productImages: [{ assetId: "h" }, { assetId: "a" }, { assetId: "b" }, { assetId: "c" }] });
    const tooLong = {
      ...run,
      steps: run.steps.map((s) => (s.id === "gallery_callouts" ? { ...s, status: "failed" as const, error: { code: "text_too_long", message: "bullets[1] is too long" } } : s)),
    };
    const copy = await cardsPipeline.actions!.regenerate.run(actionCtx(tooLong, files, { assetId: "gallery_callouts" }));
    assert.ok(copy.type === "error" && copy.status === 409, JSON.stringify(copy));
    assert.match(copy.type === "error" ? copy.error : "", /too long/);
    // Three uploaded angles: cutouts only, nothing a new seed would change.
    const cutouts = await cardsPipeline.actions!.regenerate.run(actionCtx(run, files, { assetId: "gallery_angles" }));
    assert.ok(cutouts.type === "error" && cutouts.status === 409, JSON.stringify(cutouts));
    // ...but a failed cutout can be retried, and only it is resubmitted.
    const broken = { ...run, steps: run.steps.map((s) => (s.id === "gallery_angles_cut_2" ? { ...s, status: "failed" as const, jobId: undefined } : s)) };
    const retry = await cardsPipeline.actions!.regenerate.run(actionCtx(broken, files, { assetId: "gallery_angles" }));
    assert.equal(retry.type, "replan");
    if (retry.type !== "replan") return;
    const reset = retry.steps.filter((s) => s.status === "pending").map((s) => s.id);
    assert.deepEqual(reset, ["gallery_angles_cut_2", "gallery_angles"]);
  });

  it("regenerating a part-uploaded angles card keeps its succeeded cutouts", async () => {
    const files = new Map<string, Uint8Array>();
    const run = await succeeded({ ...FULL, scope: undefined, assets: ["gallery_angles"], productImages: [{ assetId: "h" }, { assetId: "side" }] });
    const res = await cardsPipeline.actions!.regenerate.run(actionCtx(run, files, { assetId: "gallery_angles" }));
    assert.equal(res.type, "replan");
    if (res.type !== "replan") return;
    assert.deepEqual(
      res.steps.filter((s) => s.status === "pending").map((s) => s.id),
      ["gallery_angles_gen_1", "gallery_angles_gen_2", "gallery_angles"],
    );
    assert.equal(res.steps.find((s) => s.id === "gallery_angles_cut_1")?.jobId, "job_gallery_angles_cut_1");
  });

  it("exports a ZIP of finished tiles named NN_<asset_id>.<ext> plus cards.json (§8)", async () => {
    const { run, files } = await finishedRun();
    const res = await cardsPipeline.actions!.export.run(actionCtx(run, files));
    assert.equal(res.type, "response");
    if (res.type !== "response") return;
    assert.equal(res.response.headers.get("content-type"), "application/zip");
    const entries = unzipStore(new Uint8Array(await res.response.arrayBuffer()));
    assert.deepEqual(Object.keys(entries).sort(), ["01_hero.png", "02_gallery_callouts.png", "05_gallery_in_use.jpg", "cards.json"]);
    const manifest = JSON.parse(new TextDecoder().decode(entries["cards.json"]));
    assert.equal(manifest.inputs.productImages, undefined);
    assert.equal(manifest.inputs.productName, "Hydra Serum");
    assert.deepEqual(
      manifest.tiles.map((t: { asset: string; file: string | null }) => [t.asset, t.file]),
      [
        ["hero", "01_hero.png"],
        ["gallery_callouts", "02_gallery_callouts.png"],
        ["gallery_in_use", "05_gallery_in_use.jpg"],
        ["story_results", null],
      ],
    );
  });

  it("round-trips a stored zip", () => {
    const zip = zipStore({ "a.txt": new Uint8Array([1, 2, 3]), "b/c.bin": new Uint8Array(0) });
    assert.deepEqual(unzipStore(zip), { "a.txt": new Uint8Array([1, 2, 3]), "b/c.bin": new Uint8Array(0) });
  });
});
