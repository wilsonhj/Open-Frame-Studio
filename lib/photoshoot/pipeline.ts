/**
 * Product Shoot pipeline (slice D; docs/spec/photoshoot.md §6–§8).
 *
 * One `cutout` comfy step on the hero product image, then N
 * `klein_edit_multiref` steps with the cutout as image 1, each with its own
 * enhancer prompt and seed. Modes with `identityK > 0` (`hands_on`,
 * `on_model`) bind a selected Identity's best refs as images 2.. and name
 * them in the prompt; without one they describe a person instead, and the run
 * is never blocked. An Identity that can't be used refuses the plan (404/400
 * on `identityId`). Other modes ignore an identity id, with a notice. The
 * runner skips the frames when the cutout fails; retrying a frame re-runs the
 * failed cutout too.
 */
import { buildPrompts } from "../enhancer/variation.ts";
import { DEMO_MODES, KLEIN_SIZES, MODE_TEMPLATES, isDemoMode } from "../enhancer/modes.ts";
import type { ActionHandler, PipelineDefinition, ValidateResult } from "../pipeline/types.ts";
import type { ComfyPipelineStep, PipelineStep } from "../contracts/pipeline.ts";
import { TERMINAL_STEP_STATUSES } from "../contracts/pipeline.ts";
import type { ImageRef } from "../contracts/job.ts";
import type { AspectRatio, PhotoshootItem, PhotoshootRequest, VariationPick } from "../contracts/photoshoot.ts";
import { ASPECT_RATIOS } from "../contracts/photoshoot.ts";
import { IdentityInputError, SoulNotFoundError, bestRefs } from "../soul/registry.ts";
import { MAX_NOTES } from "./copy.ts";

const CUTOUT_STEP = "cutout";
const CUTOUT_TIMEOUT_MS = 120_000;
const KLEIN_TIMEOUT_MS = 180_000;

/** Step id of output `i`. */
export function shotStepId(index: number): string {
  return `shot-${index}`;
}

function isImageRef(value: unknown): value is ImageRef {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (typeof v.upload === "string" && v.upload.length > 0) || (typeof v.assetId === "string" && v.assetId.length > 0);
}

function fail(error: string, field: string): ValidateResult<PhotoshootRequest> {
  return { ok: false, error, field };
}

export function validatePhotoshoot(raw: unknown): ValidateResult<PhotoshootRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("request must be a JSON object", "");
  const r = raw as Record<string, unknown>;

  if (!isDemoMode(r.mode)) return fail(`unknown mode; valid modes: ${DEMO_MODES.join(", ")}`, "mode");
  const template = MODE_TEMPLATES[r.mode];

  if (!Array.isArray(r.images) || r.images.length === 0) return fail("a product image is required", "images");
  if (r.images.length > 6) return fail("at most 6 product images", "images");
  for (let i = 0; i < r.images.length; i++) {
    if (!isImageRef(r.images[i])) return fail("expected { upload } or { assetId }", `images[${i}]`);
  }

  const prompt = r.prompt ?? "";
  if (typeof prompt !== "string") return fail("notes must be a string", "prompt");
  if (prompt.length > MAX_NOTES) return fail(`notes must be at most ${MAX_NOTES} characters`, "prompt");

  // Out-of-range counts and ratios are not errors: plan clamps the count to the
  // mode's range and snaps the ratio to the nearest one the mode offers, and
  // buildResult reports each change as a notice (lib/contracts/photoshoot.ts,
  // docs/spec/photoshoot.md §3, §8). The request keeps what was asked.
  const count = r.count ?? template.count.def;
  if (typeof count !== "number" || !Number.isInteger(count)) return fail("count must be an integer", "count");

  let aspectRatio: AspectRatio | undefined;
  if (r.aspectRatio !== undefined) {
    if (typeof r.aspectRatio !== "string" || !parseRatio(r.aspectRatio)) {
      return fail(`aspect ratio must look like "16:9"; offered: ${ASPECT_RATIOS.join(", ")}`, "aspectRatio");
    }
    aspectRatio = r.aspectRatio as AspectRatio;
  }

  if (r.seed !== undefined && (typeof r.seed !== "number" || !Number.isInteger(r.seed) || r.seed < 0)) {
    return fail("seed must be a non-negative integer", "seed");
  }
  if (r.identityId !== undefined && typeof r.identityId !== "string") return fail("identityId must be a string", "identityId");

  const value: PhotoshootRequest = {
    mode: r.mode,
    prompt: prompt.trim(),
    images: r.images as ImageRef[],
    count,
  };
  if (aspectRatio) value.aspectRatio = aspectRatio;
  if (typeof r.seed === "number") value.seed = r.seed;
  if (typeof r.identityId === "string" && r.identityId) value.identityId = r.identityId;
  return { ok: true, value };
}

/** `"W:H"` with positive integers → W/H, else null. */
function parseRatio(value: string): number | null {
  const m = /^(\d{1,4}):(\d{1,4})$/.exec(value);
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  return w > 0 && h > 0 ? w / h : null;
}

/** The mode's ratio closest to the asked one (log distance), else the mode default. */
export function resolveAspect(request: PhotoshootRequest): { aspect: AspectRatio; snapped: boolean } {
  if (!isDemoMode(request.mode)) return { aspect: "1:1", snapped: false };
  const template = MODE_TEMPLATES[request.mode];
  const asked = request.aspectRatio;
  if (!asked) return { aspect: template.defaultAspect, snapped: false };
  const offered = template.aspects as readonly AspectRatio[];
  if (offered.includes(asked)) return { aspect: asked, snapped: false };
  const target = parseRatio(asked);
  if (target === null) return { aspect: template.defaultAspect, snapped: true };
  let best: AspectRatio = template.defaultAspect;
  let bestDistance = Infinity;
  for (const ratio of offered) {
    const distance = Math.abs(Math.log(parseRatio(ratio)! / target));
    if (distance < bestDistance) [best, bestDistance] = [ratio, distance];
  }
  return { aspect: best, snapped: true };
}

/** The asked count clamped into the mode's range. */
export function resolveCount(request: PhotoshootRequest): { count: number; clamped: boolean } {
  if (!isDemoMode(request.mode)) return { count: request.count, clamped: false };
  const { min, max } = MODE_TEMPLATES[request.mode].count;
  const count = Math.min(max, Math.max(min, request.count));
  return { count, clamped: count !== request.count };
}

function assetIdOf(ref: ImageRef | undefined): string {
  if (!ref || !("assetId" in ref)) throw new Error("photoshoot: product image was not uploaded before plan");
  return ref.assetId;
}

const identityError = (message: string) => Object.assign(new Error(message), { status: 400, field: "identityId" });

/** The Identity refs' asset ids (images 2..), or none when the mode doesn't use one or none is selected. */
async function identityAssets(request: PhotoshootRequest): Promise<string[]> {
  if (!request.identityId || !isDemoMode(request.mode)) return [];
  const k = MODE_TEMPLATES[request.mode].identityK;
  if (k === 0) return [];
  let refs;
  try {
    refs = await bestRefs(request.identityId, k);
  } catch (e) {
    // Unknown: 404 (the runner maps SoulNotFoundError); refused, e.g. no consent record: 400.
    if (e instanceof SoulNotFoundError || e instanceof IdentityInputError) throw e;
    throw identityError("That identity can't be used right now. Try again, or shoot without it.");
  }
  if (refs.length === 0) throw identityError("That identity has no usable reference photo.");
  return refs.map((r) => r.assetId);
}

function kleinStep(
  index: number,
  prompt: string,
  seed: number,
  aspect: AspectRatio,
  variation: VariationPick,
  identityRefs: string[],
): ComfyPipelineStep {
  const { width, height } = KLEIN_SIZES[aspect];
  // Unbound optional slots are dropped from the graph (lib/bindings/prepare.ts).
  const refs = Object.fromEntries(identityRefs.map((assetId, i) => [`image_${i + 2}`, assetId]));
  return {
    id: shotStepId(index),
    kind: "comfy",
    workflow: "klein_edit_multiref",
    dependsOn: [CUTOUT_STEP],
    inputs: {
      image_1: { fromStep: CUTOUT_STEP, outputNode: "cutout" },
      ...refs,
      prompt,
      seed,
      width,
      height,
    },
    timeoutMs: KLEIN_TIMEOUT_MS,
    status: "pending",
    // Kept on the step so buildResult survives per-item seed retries. The
    // resolved aspect lets the UI lay out frames before a result exists,
    // never from the raw requested ratio.
    data: { variation, aspect },
  };
}

function planShots(request: PhotoshootRequest, baseSeed: number, identityRefs: string[]): PipelineStep[] {
  if (!isDemoMode(request.mode)) throw new Error(`photoshoot: unsupported mode ${request.mode}`);
  const template = MODE_TEMPLATES[request.mode];
  const { aspect } = resolveAspect(request);
  const { count } = resolveCount(request);
  return buildPrompts(template, request.prompt, count, baseSeed, identityRefs.length > 0).map((p) =>
    kleinStep(p.index, p.prompt, p.seed, aspect, p.variation, identityRefs),
  );
}

function storedPick(step: PipelineStep | undefined): VariationPick | null {
  const data = step?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data.variation;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as unknown as VariationPick;
}

/** Every shot step stores its pick at plan time (and retry keeps it); this only covers a malformed run. */
const EMPTY_PICK: VariationPick = { preset: "", lighting: "", angle: "", palette: "" };

const retryItem: ActionHandler<"photoshoot"> = {
  method: "POST",
  path: "items/:index/retry",
  async run(ctx) {
    const index = Number(ctx.params.index);
    const id = shotStepId(index);
    const target = ctx.run.steps.find((s) => s.id === id);
    if (!Number.isInteger(index) || !target || target.kind !== "comfy") {
      return { type: "error", status: 404, error: `no item ${ctx.params.index}` };
    }
    if (!TERMINAL_STEP_STATUSES.includes(target.status)) {
      return { type: "error", status: 409, error: "item is still in progress" };
    }
    const cutout = ctx.run.steps.find((s) => s.id === CUTOUT_STEP);
    const steps: PipelineStep[] = ctx.run.steps.map((s) => {
      if (s.id === id) {
        return {
          id: s.id,
          kind: "comfy",
          workflow: target.workflow,
          dependsOn: s.dependsOn,
          inputs: { ...s.inputs, seed: ctx.plan.randomSeed() },
          timeoutMs: s.timeoutMs,
          status: "pending",
          data: s.data,
        };
      }
      // A failed cutout blocks every shot: retry it too, unless an earlier
      // retry already restarted it (resetting a live step is refused).
      if (s.id === CUTOUT_STEP && cutout && cutout.status !== "succeeded" && TERMINAL_STEP_STATUSES.includes(cutout.status)) {
        return {
          id: s.id,
          kind: "comfy",
          workflow: "cutout",
          dependsOn: s.dependsOn,
          inputs: s.inputs,
          timeoutMs: s.timeoutMs,
          status: "pending",
        };
      }
      return s;
    });
    return { type: "replan", steps };
  },
};

export const photoshootPipeline: PipelineDefinition<"photoshoot"> = {
  kind: "photoshoot",
  validate: validatePhotoshoot,
  async plan(request, ctx) {
    // The identity first: one that can't be resolved refuses the plan before anything else.
    const identityRefs = await identityAssets(request);
    const baseSeed = typeof request.seed === "number" ? request.seed >>> 0 : ctx.randomSeed();
    const cutout: ComfyPipelineStep = {
      id: CUTOUT_STEP,
      kind: "comfy",
      workflow: "cutout",
      dependsOn: [],
      inputs: { image: assetIdOf(request.images[0]) },
      timeoutMs: CUTOUT_TIMEOUT_MS,
      status: "pending",
    };
    return [cutout, ...planShots(request, baseSeed, identityRefs)];
  },
  handlers: {},
  async buildResult(run) {
    const { aspect, snapped } = resolveAspect(run.request);
    const { count, clamped } = resolveCount(run.request);
    const notices: string[] = [];
    if (clamped) notices.push(`Asked for ${run.request.count}; this mode makes ${count}.`);
    if (snapped) notices.push(`Aspect ${run.request.aspectRatio} isn't offered for this mode; used the nearest, ${aspect}.`);
    const usesIdentity = isDemoMode(run.request.mode) && MODE_TEMPLATES[run.request.mode].identityK > 0;
    if (run.request.identityId && !usesIdentity) {
      notices.push("Identity ignored: this mode shows the product only. Hands-on and On model can use it.");
    }
    const cutout = run.steps.find((s) => s.id === CUTOUT_STEP);
    const items: PhotoshootItem[] = [];
    for (let i = 0; i < count; i++) {
      const step = run.steps.find((s) => s.id === shotStepId(i));
      const output = step?.outputs?.find((o) => o.type === "image") ?? step?.outputs?.[0] ?? null;
      let error = step?.error ?? null;
      // Keep the cutout's message, but say the cutout (not this frame) failed.
      if (!error && step?.status === "skipped" && cutout?.error) error = { ...cutout.error, code: "cutout_failed" };
      items.push({
        index: i,
        seed: typeof step?.inputs.seed === "number" ? step.inputs.seed : 0,
        status: step?.status ?? "pending",
        variation: storedPick(step) ?? EMPTY_PICK,
        output,
        error,
      });
    }
    return { mode: run.request.mode, aspectRatio: aspect, count, notices, items };
  },
  actions: { retry: retryItem },
};
