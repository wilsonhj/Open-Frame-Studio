/**
 * Motion pipeline (slice F; docs/spec/api.md §2.4, docs/spec/ux.md §8).
 *
 * One `h3_r2v` comfy step: `<Picture 1>` is the person (an identity's best ref
 * from the registry, or an uploaded person photo; exactly one), `<Picture 2>`
 * the product. The prompt, seed, frame count and quality are resolved at plan
 * time, so a resumed run never re-plans. `final` (the default) is turbo off
 * with 20 base steps; `preview` is the 4-step turbo LoRA (docs/spikes/h3-r2v.md).
 * The graph already loads `minimax_h3_video_vae_fp16` (the int8 VAE is not on
 * Comfy Cloud); nothing here can change that.
 *
 * MiniMax H3 is open weights under the conditional MiniMax H3 Community
 * License, not a permissive licence: see `H3_LICENCE_NOTICE`.
 */
import { H3_ASPECT_OPTIONS } from "../bindings/h3_r2v.ts";
import { SoulNotFoundError, bestRefs } from "../soul/registry.ts";
import type { PipelineDefinition, ValidateResult } from "../pipeline/types.ts";
import type { ComfyPipelineStep } from "../contracts/pipeline.ts";
import { DEFAULT_STEP_TIMEOUT_MS } from "../contracts/pipeline.ts";
import type { ImageRef } from "../contracts/job.ts";
import type { MotionAspect, MotionRequest } from "../contracts/motion.ts";
import {
  DEFAULT_ASPECT,
  FINAL_STEPS,
  MAX_SECONDS,
  MIN_SECONDS,
  MOTION_IDENTITIES_ENABLED,
  MOTION_LENGTHS,
  PREVIEW_STEPS,
  pickClipVideo,
  stepsFor,
} from "./options.ts";
import { MAX_MOTION_PROMPT, buildMotionPrompt, framesFor } from "./prompt.ts";

export { DEFAULT_ASPECT, FINAL_STEPS, H3_LICENCE_NOTICE, MOTION_LENGTHS, PREVIEW_STEPS, stepsFor } from "./options.ts";

export const CLIP_STEP = "clip";

const ASPECTS = Object.keys(H3_ASPECT_OPTIONS) as MotionAspect[];

function isImageRef(value: unknown): value is ImageRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (typeof v.upload === "string" && v.upload.length > 0) || (typeof v.assetId === "string" && v.assetId.length > 0);
}

function fail(error: string, field: string): ValidateResult<MotionRequest> {
  return { ok: false, error, field };
}

export function validateMotion(raw: unknown): ValidateResult<MotionRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("request must be a JSON object", "");
  const r = raw as Record<string, unknown>;

  const hasIdentity = r.identityId !== undefined && r.identityId !== null && r.identityId !== "";
  const hasPerson = r.personImage !== undefined && r.personImage !== null;
  if (hasIdentity && hasPerson) return fail("use an identity or a person photo, not both", "personImage");
  if (!hasIdentity && !hasPerson) return fail("clips need a person: pick an identity or upload a photo", "personImage");
  if (hasIdentity && typeof r.identityId !== "string") return fail("identityId must be a string", "identityId");
  // Checked here, before the runtime uploads anything (see MOTION_IDENTITIES_ENABLED).
  if (hasIdentity && !MOTION_IDENTITIES_ENABLED) {
    return fail("Identities can't be used for clips yet. Upload a person photo instead.", "identityId");
  }
  if (hasPerson && !isImageRef(r.personImage)) return fail("expected { upload } or { assetId }", "personImage");

  if (!isImageRef(r.productImage)) return fail("a product image is required", "productImage");

  if (typeof r.prompt !== "string" || !r.prompt.trim()) return fail("describe the clip in a short line", "prompt");
  if (r.prompt.length > MAX_MOTION_PROMPT) return fail(`prompt must be at most ${MAX_MOTION_PROMPT} characters`, "prompt");

  if (
    r.duration !== undefined &&
    (typeof r.duration !== "number" || !Number.isFinite(r.duration) || r.duration < MIN_SECONDS || r.duration > MAX_SECONDS)
  ) {
    return fail(`duration must be ${MIN_SECONDS}–${MAX_SECONDS} seconds`, "duration");
  }
  if (r.aspectRatio !== undefined && !ASPECTS.includes(r.aspectRatio as MotionAspect)) {
    return fail(`aspect ratio must be one of ${ASPECTS.join(", ")}`, "aspectRatio");
  }
  if (r.quality !== undefined && r.quality !== "preview" && r.quality !== "final") {
    return fail('quality must be "preview" or "final"', "quality");
  }
  if (r.refFidelity !== undefined && r.refFidelity !== "match" && r.refFidelity !== "max") {
    return fail('likeness must be "match" or "max"', "refFidelity");
  }
  if (r.seed !== undefined && (typeof r.seed !== "number" || !Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff)) {
    return fail("seed must be an integer in 0..4294967295", "seed");
  }

  const value: MotionRequest = { productImage: r.productImage as ImageRef, prompt: r.prompt.trim() };
  if (hasIdentity) value.identityId = r.identityId as string;
  else value.personImage = r.personImage as ImageRef;
  if (typeof r.duration === "number") value.duration = r.duration;
  if (r.aspectRatio !== undefined) value.aspectRatio = r.aspectRatio as MotionAspect;
  if (r.quality !== undefined) value.quality = r.quality as "preview" | "final";
  if (r.refFidelity !== undefined) value.refFidelity = r.refFidelity as "match" | "max";
  if (typeof r.seed === "number") value.seed = r.seed;
  return { ok: true, value };
}

function assetIdOf(ref: ImageRef | undefined, what: string): string {
  if (!ref || !("assetId" in ref)) throw new Error(`motion: ${what} was not uploaded before plan`);
  return ref.assetId;
}

const identityError = (message: string) => Object.assign(new Error(message), { status: 400, field: "identityId" });

/**
 * `<Picture 1>`: the uploaded person, or the identity's primary (★1) ref.
 * An unknown identity stays a SoulNotFoundError (404); any other registry
 * failure is a 400 on `identityId`, never a 500.
 */
async function personAsset(request: MotionRequest): Promise<string> {
  if (request.personImage) return assetIdOf(request.personImage, "person image");
  let primary;
  try {
    [primary] = await bestRefs(request.identityId!, 1);
  } catch (e) {
    if (e instanceof SoulNotFoundError) throw e;
    throw identityError("That identity can't be used right now. Upload a person photo instead.");
  }
  if (!primary) throw identityError("That identity has no usable reference photo.");
  return primary.assetId;
}

export const motionPipeline: PipelineDefinition<"motion"> = {
  kind: "motion",
  validate: validateMotion,
  async plan(request, ctx) {
    // The person first: an identity that can't be resolved refuses the plan before anything else.
    const person = await personAsset(request);
    const product = assetIdOf(request.productImage, "product image");
    const quality = request.quality ?? "final";
    const seconds = request.duration ?? MOTION_LENGTHS[0];
    const aspect = request.aspectRatio ?? DEFAULT_ASPECT;
    const seed = typeof request.seed === "number" ? request.seed : ctx.randomSeed();
    const prompt = buildMotionPrompt(request.prompt);
    const clip: ComfyPipelineStep = {
      id: CLIP_STEP,
      kind: "comfy",
      workflow: "h3_r2v",
      dependsOn: [],
      inputs: {
        image_1: person,
        image_2: product,
        prompt,
        seed,
        duration: seconds,
        turbo: quality === "preview",
        steps_base: FINAL_STEPS,
        steps_turbo: PREVIEW_STEPS,
        aspect_ratio: H3_ASPECT_OPTIONS[aspect],
        ref_image_size: request.refFidelity ?? "match",
      },
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS.h3_r2v,
      status: "pending",
      data: { quality, aspect, seconds, frames: framesFor(seconds), steps: stepsFor(quality) },
    };
    return [clip];
  },
  handlers: {},
  async buildResult(run) {
    const clip = run.steps.find((s) => s.id === CLIP_STEP);
    const video = pickClipVideo(clip?.outputs);
    const seed = typeof clip?.inputs.seed === "number" ? clip.inputs.seed : 0;
    const seconds = typeof clip?.inputs.duration === "number" ? clip.inputs.duration : (run.request.duration ?? MOTION_LENGTHS[0]);
    return { video, seed, frames: framesFor(seconds) };
  },
};
