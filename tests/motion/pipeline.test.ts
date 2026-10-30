import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { PipelineRun, PlanContext } from "../../lib/pipeline/types.ts";
import type { ComfyPipelineStep } from "../../lib/contracts/pipeline.ts";
import { applyBindings } from "../../lib/bindings/apply.ts";
import { h3R2v } from "../../lib/bindings/h3_r2v.ts";
import { prepareGraph } from "../../lib/bindings/prepare.ts";
import {
  CLIP_STEP,
  FINAL_STEPS,
  H3_LICENCE_NOTICE,
  PREVIEW_STEPS,
  motionPipeline,
  validateMotion,
} from "../../lib/motion/pipeline.ts";
import { MOTION_IDENTITIES_ENABLED, pickClipVideo } from "../../lib/motion/options.ts";
import { buildMotionPrompt, framesFor } from "../../lib/motion/prompt.ts";
import { identitiesDir } from "../../lib/soul/registry.ts";
import { IDENTITY_SCHEMA } from "../../lib/types.ts";

const ctx: PlanContext = { runId: "run_1", now: "2026-10-30T00:00:00.000Z", randomSeed: () => 777 };
const base = { personImage: { upload: "person" }, productImage: { upload: "product" }, prompt: "[Person] holds [Product] up" };
const planned = { ...base, personImage: { assetId: "p1" }, productImage: { assetId: "b1" } };

async function planClip(request: Record<string, unknown>): Promise<ComfyPipelineStep> {
  const checked = validateMotion(request);
  assert.ok(checked.ok, checked.ok ? "" : checked.error);
  const steps = await motionPipeline.plan(checked.value, ctx);
  assert.equal(steps.length, 1);
  const [clip] = steps;
  assert.equal(clip.kind, "comfy");
  return clip as ComfyPipelineStep;
}

describe("motion validate: exactly one person source", () => {
  it("accepts an uploaded person photo", () => {
    const r = validateMotion(base);
    assert.ok(r.ok);
    assert.deepEqual(r.value.personImage, { upload: "person" });
    assert.equal(r.value.identityId, undefined);
  });

  it("refuses an identity at validate (before any upload) while identities are off", () => {
    assert.equal(MOTION_IDENTITIES_ENABLED, false);
    const { personImage, ...rest } = base;
    void personImage;
    const r = validateMotion({ ...rest, identityId: "maya" });
    assert.ok(!r.ok);
    assert.equal(r.field, "identityId");
  });

  it("refuses both, and refuses neither", () => {
    const both = validateMotion({ ...base, identityId: "maya" });
    assert.ok(!both.ok && both.field === "personImage" && /not both/.test(both.error));
    const { personImage, ...none } = base;
    void personImage;
    const neither = validateMotion(none);
    assert.ok(!neither.ok && neither.field === "personImage");
  });

  it("requires a product, a prompt, and in-range options", () => {
    const fields = [
      [{ ...base, productImage: undefined }, "productImage"],
      [{ ...base, prompt: "  " }, "prompt"],
      [{ ...base, duration: 3 }, "duration"],
      [{ ...base, duration: 20 }, "duration"],
      [{ ...base, aspectRatio: "21:9" }, "aspectRatio"],
      [{ ...base, quality: "turbo" }, "quality"],
      [{ ...base, refFidelity: "best" }, "refFidelity"],
      [{ ...base, seed: -1 }, "seed"],
      [{ ...base, personImage: { url: "https://x" } }, "personImage"],
    ] as const;
    for (const [request, field] of fields) {
      const r = validateMotion(request);
      assert.ok(!r.ok, `expected ${field} to fail`);
      assert.equal(r.field, field);
    }
  });
});

describe("motion prompt builder", () => {
  it("maps role tokens to <Picture N> and always names both roles", () => {
    const prompt = buildMotionPrompt("[Person] holds [ product ] up to the light");
    assert.match(prompt, /<Picture 1> is the person/);
    assert.match(prompt, /<Picture 2> is the product/);
    assert.ok(prompt.endsWith("<Picture 1> holds <Picture 2> up to the light"));
  });

  it("drops raw <Picture N> tags a user typed (the graph has two references)", () => {
    const prompt = buildMotionPrompt("<Picture 3> waves next to <picture 1>");
    assert.ok(!prompt.includes("<Picture 3>"));
    assert.ok(prompt.endsWith("waves next to"));
  });
});

describe("motion plan", () => {
  it("final (default) is turbo off with 20 base steps, on the h3_r2v graph", async () => {
    const clip = await planClip(planned);
    assert.equal(clip.id, CLIP_STEP);
    assert.equal(clip.workflow, "h3_r2v");
    assert.equal(clip.inputs.turbo, false);
    assert.equal(clip.inputs.steps_base, FINAL_STEPS);
    assert.equal(FINAL_STEPS >= 20 && FINAL_STEPS <= 25, true);
    assert.deepEqual(clip.data, { quality: "final", aspect: "9:16", seconds: 5, frames: 124, steps: 20 });
  });

  it("preview is the 4-step turbo LoRA", async () => {
    const clip = await planClip({ ...planned, quality: "preview" });
    assert.equal(clip.inputs.turbo, true);
    assert.equal(clip.inputs.steps_turbo, PREVIEW_STEPS);
  });

  it("wires person to <Picture 1>, product to <Picture 2>, and resolves the seed at plan time", async () => {
    const clip = await planClip(planned);
    assert.equal(clip.inputs.image_1, "p1");
    assert.equal(clip.inputs.image_2, "b1");
    assert.equal(clip.inputs.seed, 777);
    const seeded = await planClip({ ...planned, seed: 0 });
    assert.equal(seeded.inputs.seed, 0, "a supplied seed of 0 is kept");
  });

  it("maps the aspect to a ResolutionSelector option and likeness to ref_image_size", async () => {
    const clip = await planClip({ ...planned, aspectRatio: "16:9", refFidelity: "max" });
    assert.equal(clip.inputs.aspect_ratio, "16:9 (Widescreen)");
    assert.equal(clip.inputs.ref_image_size, "max");
  });

  it("an unknown identity stays a not-found (the runner answers 404 on identityId), not a 500", async () => {
    const { personImage, ...rest } = planned;
    void personImage;
    await assert.rejects(motionPipeline.plan({ ...rest, identityId: "maya" }, ctx), (e: { name?: string }) => {
      assert.equal(e.name, "SoulNotFoundError");
      return true;
    });
  });

  it("an identity the registry refuses (no consent record) is a 400 on identityId, not a 500", async () => {
    const saved = process.env.DATA_DIR;
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "motion-identity-"));
    try {
      const id = randomUUID();
      const doc = { schema: IDENTITY_SCHEMA, id, name: "No consent", createdAt: ctx.now, refs: [] };
      mkdirSync(join(identitiesDir(), id), { recursive: true });
      writeFileSync(join(identitiesDir(), id, "identity.json"), JSON.stringify(doc));
      const { personImage, ...rest } = planned;
      void personImage;
      await assert.rejects(motionPipeline.plan({ ...rest, identityId: id }, ctx), (e: { status?: number; field?: string }) => {
        assert.equal(e.status, 400);
        assert.equal(e.field, "identityId");
        return true;
      });
    } finally {
      rmSync(process.env.DATA_DIR, { recursive: true, force: true });
      if (saved === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = saved;
    }
  });

  it("applies to the real graph through prepareGraph, keeping the fp16 video VAE", async () => {
    const clip = await planClip({ ...planned, quality: "preview", duration: 8 });
    const graph = JSON.parse(readFileSync("workflows/h3_r2v.api.json", "utf8"));
    const values: Record<string, unknown> = { ...clip.inputs };
    // What the runner does (lib/pipeline/runner.ts): structural prep, then values.
    const out = applyBindings(prepareGraph("h3_r2v", graph, values as never), h3R2v, values as never) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    assert.equal(out["146"].inputs.value, true);
    assert.equal(out["144"].inputs.value, PREVIEW_STEPS);
    assert.equal(out["132"].inputs.value, 8);
    assert.equal(out["129"].inputs.noise_seed, 777);
    assert.match(String(out["138"].inputs.value), /<Picture 1>/);
    const vaes = Object.values(out).filter((n) => (n as { class_type?: string }).class_type === "VAELoader");
    assert.ok(vaes.some((n) => n.inputs.vae_name === "minimax_h3_video_vae_fp16.safetensors"));
  });
});

describe("motion frames and result", () => {
  it("matches the graph's 17k+5 frame grid", () => {
    assert.equal(framesFor(5), 124);
    assert.equal(framesFor(8), 192);
    assert.equal(framesFor(10), 243);
    for (const s of [5, 6.5, 8, 10, 12, 15]) assert.equal((framesFor(s) - 5) % 17, 0);
    assert.ok(framesFor(15) <= 362);
  });

  it("buildResult returns the video output, the seed and the frame count", async () => {
    const clip = await planClip(planned);
    const video = { id: "v", jobId: "j", nodeId: "92", name: "c.mp4", type: "video" as const, contentType: "video/mp4", sizeBytes: 1, url: "/x" };
    const run = { request: validateMotion(planned).ok ? planned : null, steps: [{ ...clip, status: "succeeded", outputs: [video] }] };
    const result = await motionPipeline.buildResult(run as unknown as PipelineRun<"motion">);
    assert.deepEqual(result, { video, seed: 777, frames: 124 });
  });
});

describe("motion result on Comfy Cloud", () => {
  it("picks the MP4 from the video node even when Cloud labels it type image", async () => {
    const clip = await planClip(planned);
    const still = { id: "s", jobId: "j", nodeId: "50", name: "frame.png", type: "image" as const, contentType: "image/png", sizeBytes: 1, url: "/s" };
    const video = { id: "v", jobId: "j", nodeId: h3R2v.outputs.video, name: "clip_00001.mp4", type: "image" as const, contentType: "video/mp4", sizeBytes: 1, url: "/v" };
    const run = { request: planned, steps: [{ ...clip, status: "succeeded", outputs: [still, video] }] };
    const result = await motionPipeline.buildResult(run as unknown as PipelineRun<"motion">);
    assert.equal(result.video?.id, "v");
  });

  it("falls back to the content type, then the file extension, when no node id matches", () => {
    const o = { jobId: "j", nodeId: "", type: "image" as const, sizeBytes: 1, url: "/x" };
    const png = { ...o, id: "p", name: "a.png", contentType: "image/png" };
    assert.equal(pickClipVideo([png, { ...o, id: "c", name: "a.bin", contentType: "video/mp4" }])?.id, "c");
    assert.equal(pickClipVideo([png, { ...o, id: "e", name: "a.webm", contentType: "" }])?.id, "e");
    assert.equal(pickClipVideo([png]), null);
  });
});

describe("H3 licence notice", () => {
  it("never calls H3 permissive and names the excluded territories", () => {
    assert.match(H3_LICENCE_NOTICE, /not a permissive/);
    assert.doesNotMatch(H3_LICENCE_NOTICE.replace("not a permissive", ""), /permissive/i);
    for (const t of ["United States", "European Union", "United Kingdom", "South Korea"]) assert.ok(H3_LICENCE_NOTICE.includes(t));
    assert.match(H3_LICENCE_NOTICE, /Comfy Cloud/);
  });
});
