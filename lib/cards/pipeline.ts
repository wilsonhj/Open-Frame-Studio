/**
 * Listing Images pipeline (slice E, docs/spec/listing.md).
 *
 * `cutout` (Comfy) → `compose_main` (code: compose + A1–A7 and C3) is the hero
 * and the anchor (§6). Every other asset in the scope fans out after it (R-A4):
 * optional diffusion steps (Klein edit with the anchor as image 1, or Klein
 * t2i), an optional SeedVR2 ×2 for full-bleed images (G4), then one
 * `render_card` code step that draws the layout and copy (G1). An asset whose
 * required copy is missing plans no diffusion and ends `needs_input` (G7).
 */
import type {
  ActionHandler,
  CodeHandler,
  CodeHandlerResult,
  PipelineDefinition,
  PlanContext,
  ValidateResult,
} from "../pipeline/types.ts";
import type {
  CardAssetId,
  CardScope,
  CardsRequest,
  CardTile,
  CropBox,
  ImageRef,
  JsonValue,
  MainImageCheck,
  MainImageResult,
  PipelineRun,
  PipelineStep,
  StepInputRef,
} from "../types.ts";
import { CARD_ASSETS, DEFAULT_STEP_TIMEOUT_MS, TERMINAL_STEP_STATUSES } from "../types.ts";
import { cutout as cutoutBinding } from "../bindings/cutout.ts";
import { assetFileName, assetOrder, CARD_SPECS, expandAssets, missingCopy } from "./assets.ts";
import { TextFitError } from "./canvas.ts";
import { paletteFor, renderCard } from "./layouts.ts";
import { analyzeCutout, checkMain, composeMain, mainOk } from "./main.ts";
import { feeders, regenerateBlocker, tileFor } from "./tiles.ts";
import { zipStore } from "./zip.ts";

const CUTOUT_STEP = "cutout";
const COMPOSE_STEP = "compose_main";
const RENDER = "render_card";
/** Logical output name (the runtime maps it to the graph node). */
const CUTOUT_OUTPUT = "cutout";
const ANCHOR: StepInputRef = { fromStep: CUTOUT_STEP, outputNode: CUTOUT_OUTPUT };
const SCOPES: readonly CardScope[] = ["hero", "gallery", "story", "complete"];

// ---------------------------------------------------------------------------
// validate (§7 limits; T-T1, T-T4, R-S1–R-S4)
// ---------------------------------------------------------------------------

type Fail = { ok: false; error: string; field: string };
const fail = (error: string, field: string): Fail => ({ ok: false, error, field });

function isImageRef(v: unknown): v is ImageRef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (typeof o.upload === "string" && o.upload !== "") || (typeof o.assetId === "string" && o.assetId !== "");
}

/** An optional string within `max` chars; returns the trimmed value or a failure. */
function optString(r: Record<string, unknown>, field: string, max: number, min = 0): string | undefined | Fail {
  const v = r[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string") return fail(`${field} must be a string`, field);
  const t = v.trim();
  if (t === "") return undefined;
  if (t.length > max || t.length < min) return fail(`${field} must be ${min ? `${min}–` : "at most "}${max} characters`, field);
  return t;
}

function isFail(v: unknown): v is Fail {
  return !!v && typeof v === "object" && (v as Fail).ok === false;
}

function stringList(r: Record<string, unknown>, field: string, min: number, max: number, maxLen: number): string[] | undefined | Fail {
  const v = r[field];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return fail(`${field} must be a list`, field);
  if (v.length === 0) return undefined;
  if (v.length < min || v.length > max) return fail(`${field} needs ${min}–${max} entries`, field);
  const out: string[] = [];
  for (const [i, s] of v.entries()) {
    if (typeof s !== "string" || s.trim() === "") return fail("expected a non-empty string", `${field}[${i}]`);
    if (s.trim().length > maxLen) return fail(`keep it under ${maxLen} characters`, `${field}[${i}]`);
    out.push(s.trim());
  }
  return out;
}

function objectList<T>(
  r: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  item: (o: Record<string, unknown>, path: string) => T | Fail,
): T[] | undefined | Fail {
  const v = r[field];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return fail(`${field} must be a list`, field);
  if (v.length === 0) return undefined;
  if (v.length < min || v.length > max) return fail(`${field} needs ${min}–${max} entries`, field);
  const out: T[] = [];
  for (const [i, o] of v.entries()) {
    const path = `${field}[${i}]`;
    if (!o || typeof o !== "object" || Array.isArray(o)) return fail("expected an object", path);
    const parsed = item(o as Record<string, unknown>, path);
    if (isFail(parsed)) return parsed;
    out.push(parsed);
  }
  return out;
}

function text(o: Record<string, unknown>, key: string, path: string, max: number, required = true): string | undefined | Fail {
  const v = o[key];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    return required ? fail(`${key} is required`, `${path}.${key}`) : undefined;
  }
  if (typeof v !== "string") return fail(`${key} must be a string`, `${path}.${key}`);
  if (v.trim().length > max) return fail(`keep it under ${max} characters`, `${path}.${key}`);
  return v.trim();
}

function validate(raw: unknown): ValidateResult<CardsRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("request must be an object", "");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.productImages) || r.productImages.length < 1 || r.productImages.length > 6) {
    return fail("productImages must hold 1–6 images", "productImages");
  }
  for (const [i, img] of r.productImages.entries()) {
    if (!isImageRef(img)) return fail("expected { upload } or { assetId }", `productImages[${i}]`);
  }
  if (r.mainJobId !== undefined) return fail("mainJobId reuse is not supported yet", "mainJobId");
  const value: CardsRequest = { productImages: r.productImages as ImageRef[] };

  if (r.scope !== undefined) {
    if (!SCOPES.includes(r.scope as CardScope)) return fail(`scope must be one of ${SCOPES.join(", ")}`, "scope");
    value.scope = r.scope as CardScope;
  }
  if (r.assets !== undefined) {
    if (!Array.isArray(r.assets)) return fail("assets must be a list", "assets");
    for (const [i, a] of r.assets.entries()) {
      if (!CARD_ASSETS.includes(a as CardAssetId)) {
        return fail(`unknown asset; valid ids: ${CARD_ASSETS.join(", ")}`, `assets[${i}]`);
      }
    }
    if (r.assets.length > 0) value.assets = [...new Set(r.assets as CardAssetId[])];
  }
  if (!value.scope && !value.assets) value.scope = "hero";

  const strings: [keyof CardsRequest, number, number][] = [
    ["productName", 80, 2],
    ["brandName", 40, 0],
    ["category", 40, 0],
    ["visualStyle", 80, 0],
    ["tagline", 60, 0],
    ["efficacySource", 120, 0],
    ["language", 35, 0],
  ];
  for (const [field, max, min] of strings) {
    const s = optString(r, field, max, min);
    if (isFail(s)) return s;
    if (s !== undefined) (value as Record<string, unknown>)[field] = s;
  }

  const bullets = stringList(r, "bullets", 3, 5, 90);
  if (isFail(bullets)) return bullets;
  if (bullets) value.bullets = bullets;
  const howTo = stringList(r, "howToUse", 2, 4, 60);
  if (isFail(howTo)) return howTo;
  if (howTo) value.howToUse = howTo;

  if (r.brandColors !== undefined) {
    if (!Array.isArray(r.brandColors) || r.brandColors.length > 3) return fail("brandColors takes 1–3 #rrggbb colours", "brandColors");
    for (const [i, c] of r.brandColors.entries()) {
      if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return fail("expected #rrggbb", `brandColors[${i}]`);
    }
    if (r.brandColors.length) value.brandColors = r.brandColors as string[];
  }

  const ingredients = objectList(r, "ingredients", 1, 10, (o, p) => {
    const name = text(o, "name", p, 40);
    const amount = text(o, "amount", p, 20, false);
    const benefit = text(o, "benefit", p, 60, false);
    for (const v of [name, amount, benefit]) if (isFail(v)) return v;
    return { name: name as string, ...(amount ? { amount: amount as string } : {}), ...(benefit ? { benefit: benefit as string } : {}) };
  });
  if (isFail(ingredients)) return ingredients;
  if (ingredients) value.ingredients = ingredients;

  const specs = objectList(r, "specs", 1, 10, (o, p) => {
    const label = text(o, "label", p, 30);
    const v = text(o, "value", p, 50);
    for (const x of [label, v]) if (isFail(x)) return x;
    return { label: label as string, value: v as string };
  });
  if (isFail(specs)) return specs;
  if (specs) value.specs = specs;

  const boxContents = objectList(r, "boxContents", 1, 6, (o, p) => {
    if (typeof o.qty !== "number" || !Number.isInteger(o.qty) || o.qty < 1 || o.qty > 99) return fail("qty must be 1–99", `${p}.qty`);
    const name = text(o, "name", p, 40);
    if (isFail(name)) return name;
    return { qty: o.qty, name: name as string };
  });
  if (isFail(boxContents)) return boxContents;
  if (boxContents) value.boxContents = boxContents;

  const painPoints = objectList(r, "painPoints", 2, 3, (o, p) => {
    const problem = text(o, "problem", p, 50);
    const solution = text(o, "solution", p, 60);
    for (const x of [problem, solution]) if (isFail(x)) return x;
    return { problem: problem as string, solution: solution as string };
  });
  if (isFail(painPoints)) return painPoints;
  if (painPoints) value.painPoints = painPoints;

  const claims = objectList(r, "efficacyClaims", 2, 4, (o, p) => {
    const v = text(o, "value", p, 8);
    const label = text(o, "label", p, 40);
    for (const x of [v, label]) if (isFail(x)) return x;
    return { value: v as string, label: label as string };
  });
  if (isFail(claims)) return claims;
  if (claims) {
    // T-T4: a claim is never shown without its source.
    if (!value.efficacySource) return fail("efficacyClaims need an efficacySource", "efficacySource");
    value.efficacyClaims = claims;
  }

  if (r.endorsement !== undefined) {
    const e = r.endorsement as Record<string, unknown>;
    if (!e || typeof e !== "object" || Array.isArray(e)) return fail("endorsement must be an object", "endorsement");
    if (!["review", "expert", "certification"].includes(e.type as string)) {
      return fail("type must be review, expert or certification", "endorsement.type");
    }
    const t = text(e, "text", "endorsement", 160);
    const by = text(e, "by", "endorsement", 50);
    for (const x of [t, by]) if (isFail(x)) return x;
    if (typeof e.rightsConfirmed !== "boolean") return fail("rightsConfirmed must be true or false", "endorsement.rightsConfirmed");
    value.endorsement = {
      type: e.type as "review" | "expert" | "certification",
      text: t as string,
      by: by as string,
      rightsConfirmed: e.rightsConfirmed,
    };
  }

  if (r.seed !== undefined) {
    if (typeof r.seed !== "number" || !Number.isInteger(r.seed) || r.seed < 0) return fail("seed must be a non-negative integer", "seed");
    value.seed = r.seed;
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

/** G5: one style block appended to every diffusion prompt in the set. */
export function styleBlockFor(request: CardsRequest): string {
  const palette = request.brandColors?.length ? `palette ${request.brandColors.join(", ")}` : "palette drawn from the product";
  const style = request.visualStyle ?? "clean-clinical";
  return `Style: ${style}; ${palette}; soft diffused studio light; matte neutral surfaces.`;
}

const NO_TEXT = "No text, letters, logos or watermarks anywhere; keep clean empty surfaces.";

function category(request: CardsRequest): string {
  return request.category ?? "everyday home";
}

/** Prompts per diffusion step (G1: never ask for text; G3: "image 1" is the anchor). */
function prompts(asset: CardAssetId, request: CardsRequest): string[] {
  const product = request.productName ? `the ${request.productName}` : "the product";
  const s = styleBlockFor(request);
  switch (asset) {
    case "gallery_angles":
      return ["three-quarter view", "side view", "back view"].map(
        (v) => `${product} from image 1, ${v}, alone on a plain white background, same product, same colours and materials. ${NO_TEXT}`,
      );
    case "gallery_detail": {
      const named = request.specs?.[0]?.label ?? "surface texture and finish";
      return [`Macro close-up of ${product} from image 1 showing its ${named}, shallow depth of field. ${s} ${NO_TEXT}`];
    }
    case "gallery_in_use":
      return [`${product} from image 1 in use in a believable ${category(request)} scene, natural composition. ${s} ${NO_TEXT}`];
    case "gallery_contents": {
      const items = (request.boxContents ?? []).map((b) => `${b.qty} ${b.name}`).join(", ");
      return [`Top-down flat-lay on white of ${product} from image 1 together with ${items}, evenly spaced. ${NO_TEXT}`];
    }
    case "story_banner":
      return [`Wide styled ${category(request)} scene with ${product} from image 1 placed in the right half; the left 40% is calm empty space. ${s} ${NO_TEXT}`];
    case "story_problem_solution":
      return [`A calm mood image of the everyday situation ${request.painPoints?.[0]?.problem ?? "the product helps with"}, no faces, no product. ${s} ${NO_TEXT}`];
    case "story_materials": {
      const names = request.ingredients?.length
        ? request.ingredients.map((i) => i.name).join(", ")
        : (request.specs ?? []).map((x) => x.value).join(", ");
      return [`A hero arrangement of the raw materials ${names}, studio still life, no packaging. ${s} ${NO_TEXT}`];
    }
    default:
      return [];
  }
}

/**
 * Square assets whose diffusion output fills the whole 2000 px card get
 * SeedVR2 ×2 first (G4). Story panels are drawn at 1464×600, smaller than
 * their 1472×608 generation, so an upscale would be billed and thrown away.
 */
const UPSCALED: ReadonlySet<CardAssetId> = new Set(["gallery_detail", "gallery_in_use", "gallery_contents"]);

function seedFor(base: number, asset: CardAssetId, k: number): number {
  return (base + assetOrder(asset) * 7919 + k) >>> 0;
}

function genStepId(asset: CardAssetId, k: number, total: number): string {
  return total > 1 ? `${asset}_gen_${k + 1}` : `${asset}_gen`;
}

/** The steps of one non-hero asset; `seed(k)` gives the k-th diffusion seed. */
function assetSteps(asset: CardAssetId, request: CardsRequest, seed: (k: number) => number): PipelineStep[] {
  const spec = CARD_SPECS[asset];
  const steps: PipelineStep[] = [];
  const sources: StepInputRef[] = [];
  const needsCopy = missingCopy(asset, request).length > 0;
  const extraAngles = asset === "gallery_angles" ? request.productImages.slice(1, 4) : [];

  if (!needsCopy) {
    // User-supplied angles are cut out, not generated (§4.2).
    for (const [k, img] of extraAngles.entries()) {
      const id = `${asset}_cut_${k + 1}`;
      steps.push({
        id,
        kind: "comfy",
        workflow: "cutout",
        dependsOn: [COMPOSE_STEP],
        inputs: { image: "assetId" in img ? img.assetId : "" },
        timeoutMs: DEFAULT_STEP_TIMEOUT_MS.cutout,
        status: "pending",
      });
      sources.push({ fromStep: id, outputNode: CUTOUT_OUTPUT });
    }
  }
  if (!needsCopy && (spec.diffusion === "klein_edit" || spec.diffusion === "klein_t2i")) {
    // gallery_angles generates only the views the user's photos leave empty.
    const list = prompts(asset, request).slice(extraAngles.length);
    const [width, height] = spec.genPx ?? [1024, 1024];
    for (const [k, prompt] of list.entries()) {
      const id = genStepId(asset, k, list.length);
      const edit = spec.diffusion === "klein_edit";
      steps.push({
        id,
        kind: "comfy",
        workflow: edit ? "klein_edit_multiref" : "klein_t2i",
        dependsOn: [COMPOSE_STEP],
        inputs: edit ? { image_1: ANCHOR, prompt, seed: seed(k), width, height } : { prompt, seed: seed(k), width, height },
        timeoutMs: DEFAULT_STEP_TIMEOUT_MS[edit ? "klein_edit_multiref" : "klein_t2i"],
        status: "pending",
      });
      if (UPSCALED.has(asset)) {
        const up = `${asset}_up`;
        steps.push({
          id: up,
          kind: "comfy",
          workflow: "upscale",
          dependsOn: [id],
          inputs: { image: { fromStep: id, outputNode: "image" }, scale: 2, seed: seed(k) },
          timeoutMs: DEFAULT_STEP_TIMEOUT_MS.upscale,
          status: "pending",
        });
        sources.push({ fromStep: up, outputNode: "image" });
      } else {
        sources.push({ fromStep: id, outputNode: "image" });
      }
    }
  }

  const inputs: PipelineStep["inputs"] = { asset, anchor: ANCHOR };
  for (const [k, src] of sources.entries()) inputs[`g${k}`] = src;
  steps.push({
    id: asset,
    kind: "code",
    workflow: RENDER,
    dependsOn: [COMPOSE_STEP, ...sources.map((s) => s.fromStep)],
    inputs,
    timeoutMs: 60_000,
    status: "pending",
    data: { asset, seed: seed(0) },
  });
  return steps;
}

function heroSteps(request: CardsRequest): PipelineStep[] {
  const hero = request.productImages[0];
  if (!hero || !("assetId" in hero)) throw new Error("productImages[0] must be uploaded before planning");
  return [
    {
      id: CUTOUT_STEP,
      kind: "comfy",
      workflow: "cutout",
      dependsOn: [],
      inputs: { image: hero.assetId },
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS.cutout,
      status: "pending",
    },
    {
      id: COMPOSE_STEP,
      kind: "code",
      workflow: COMPOSE_STEP,
      dependsOn: [CUTOUT_STEP],
      inputs: { cutout: ANCHOR },
      timeoutMs: 60_000,
      status: "pending",
    },
  ];
}

async function plan(request: CardsRequest, ctx: PlanContext): Promise<PipelineStep[]> {
  const base = typeof request.seed === "number" ? request.seed >>> 0 : ctx.randomSeed();
  const steps = heroSteps(request);
  for (const asset of expandAssets(request)) {
    if (asset === "hero") continue;
    steps.push(...assetSteps(asset, request, (k) => seedFor(base, asset, k)));
  }
  return steps;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

/**
 * The hero file name: `NN_<asset_id>.<ext>` (docs/spec/listing.md G6), with NN
 * its order in §2. PNG, not JPEG: A1 runs on the file as written and needs an
 * exactly #FFFFFF border, which JPEG ringing would break.
 */
export const HERO_FILE = "01_hero.png";

const composeMainHandler: CodeHandler<"listing"> = async (ctx) => {
  const source = ctx.step.inputs.cutout as StepInputRef;
  const bytes = await ctx.readBytes(source);
  const { png, cutout, placed } = await composeMain(bytes);
  const checks = await checkMain(png, cutout, placed);
  const ok = mainOk(checks);
  const failed = checks.filter((c) => !c.ok && c.level === "error").map((c) => c.id);
  // Compliance gates the run: a non-compliant main image fails this step (files and checks are kept for the UI).
  return {
    status: ok ? "succeeded" : "failed",
    error: ok ? null : { code: "main_not_compliant", message: `main image failed ${failed.join(", ")}` },
    files: [{ name: HERO_FILE, contentType: "image/png", bytes: png }],
    data: { checks, ok, cutoutBbox: cutout.bbox, placed } as unknown as JsonValue,
  };
};

/** The anchor cutout trimmed to its alpha bbox, so layouts place the product, not its margin. */
async function trimmedAnchor(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const { bbox } = await analyzeCutout(bytes);
  if (bbox.width <= 0 || bbox.height <= 0) return bytes;
  return new Uint8Array(
    await sharp(bytes).ensureAlpha().extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height }).png().toBuffer(),
  );
}

const renderCardHandler: CodeHandler<"listing"> = async (ctx): Promise<CodeHandlerResult> => {
  const asset = ctx.step.inputs.asset as CardAssetId;
  const request = ctx.run.request;
  const data = (ctx.step.data ?? {}) as { seed?: number };
  const missing = missingCopy(asset, request);
  if (missing.length > 0) {
    return {
      status: "needs_input",
      data: { asset, seed: data.seed ?? null, missing },
      error: { code: "needs_input", message: `Add ${missing.map((m) => m.replace("|", " or ")).join(", ")} to make this card.` },
    };
  }
  const anchor = await trimmedAnchor(await ctx.readBytes(ctx.step.inputs.anchor as StepInputRef));
  const generated: Uint8Array[] = [];
  for (let k = 0; ctx.step.inputs[`g${k}`] !== undefined; k++) {
    generated.push(await ctx.readBytes(ctx.step.inputs[`g${k}`] as StepInputRef));
  }
  const palette = await paletteFor(request, anchor);
  try {
    const card = await renderCard(asset, { request, anchor, generated, palette });
    const format = CARD_SPECS[asset].format;
    return {
      files: [{ name: assetFileName(asset), contentType: format === "png" ? "image/png" : "image/jpeg", bytes: card.bytes }],
      data: {
        asset,
        seed: data.seed ?? null,
        missing: [],
        width: card.width,
        height: card.height,
        texts: card.texts.map((t) => ({ size: t.size, scrim: t.scrim, contrast: Math.round(t.contrast * 100) / 100 })),
      },
    };
  } catch (err) {
    // G8: never truncate; the tile fails and names the field and its budget.
    if (err instanceof TextFitError) {
      return {
        status: "failed",
        data: { asset, seed: data.seed ?? null, missing: [], field: err.field, budget: err.budget },
        error: { code: "text_too_long", message: err.message },
      };
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// result
// ---------------------------------------------------------------------------

type ComposeData = { checks: MainImageCheck[]; ok: boolean; cutoutBbox: CropBox };
async function buildResult(run: Readonly<PipelineRun<"listing">>) {
  const cutoutStep = run.steps.find((s) => s.id === CUTOUT_STEP);
  const composeStep = run.steps.find((s) => s.id === COMPOSE_STEP);
  const data = composeStep?.data as ComposeData | undefined;
  const compositeUrl = composeStep?.outputs?.[0]?.url ?? null;
  const cutoutOut =
    cutoutStep?.outputs?.find((o) => o.nodeId === cutoutBinding.outputs.cutout) ?? cutoutStep?.outputs?.[0] ?? null;

  const main: MainImageResult | null =
    data && compositeUrl
      ? {
          jobId: cutoutStep?.jobId ?? run.id,
          compositeUrl,
          cutoutRgbaUrl: cutoutOut?.url ?? "",
          cutoutBbox: data.cutoutBbox,
          checks: data.checks,
          ok: data.ok,
        }
      : null;

  // Until compose runs (pending), or when the runner skipped it because the
  // cutout failed, the hero tile reports the cutout's state and error, so the
  // board can say why instead of a bare "skipped".
  const composeWaiting = composeStep?.status === "pending" || composeStep?.status === "skipped";
  const mainState = composeWaiting && cutoutStep && cutoutStep.status !== "succeeded" ? cutoutStep.status : (composeStep?.status ?? "pending");
  const assets = expandAssets(run.request);
  const tiles: CardTile[] = CARD_ASSETS.map((asset) =>
    asset === "hero"
      ? {
          asset,
          state: mainState,
          seed: null,
          url: main?.compositeUrl ?? null,
          missing: [],
          error: composeStep?.error ?? cutoutStep?.error ?? null,
        }
      : assets.includes(asset)
        ? tileFor(run, asset)
        : { asset, state: "skipped", seed: null, url: null, missing: [], error: null },
  );
  return { assets, main, tiles, styleBlock: assets.length > 1 ? styleBlockFor(run.request) : "" };
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

/** R-A3 / T-A2: a new seed for one tile; the anchor, styleBlock and every other step are kept. */
const regenerateTile: ActionHandler<"listing"> = {
  method: "POST",
  path: "tiles/:assetId/regenerate",
  async run(ctx) {
    const asset = ctx.params.assetId as CardAssetId;
    if (asset === "hero") return { type: "error", status: 400, error: "the hero image has no seed; upload a different photo instead" };
    const render = ctx.run.steps.find((s) => s.id === asset && s.kind === "code");
    if (!CARD_ASSETS.includes(asset) || !render) return { type: "error", status: 404, error: `no tile ${ctx.params.assetId}` };
    const own = [render, ...feeders(ctx.run, asset)];
    if (own.some((s) => !TERMINAL_STEP_STATUSES.includes(s.status))) {
      return { type: "error", status: 409, error: "this tile is still in progress" };
    }
    const compose = ctx.run.steps.find((s) => s.id === COMPOSE_STEP);
    if (compose?.status !== "succeeded") return { type: "error", status: 409, error: "the hero image must succeed first" };
    const blocked = regenerateBlocker(ctx.run, asset);
    if (blocked) return { type: "error", status: 409, error: blocked };
    const base = ctx.plan.randomSeed();
    // A succeeded cutout of the user's own photo has no seed: keep it rather
    // than bill the same cutout again.
    const kept = (s: PipelineStep) => s.kind === "comfy" && s.workflow === "cutout" && s.status === "succeeded";
    const fresh = new Map(
      assetSteps(asset, ctx.run.request, (k) => (base + k) >>> 0)
        .filter((s) => !own.some((o) => o.id === s.id && kept(o)))
        .map((s) => [s.id, s]),
    );
    const steps: PipelineStep[] = ctx.run.steps.filter((s) => !own.includes(s) || fresh.has(s.id) || kept(s)).map((s) => fresh.get(s.id) ?? s);
    // A step new to this plan (none today: the shape depends only on the request) is appended.
    for (const [id, s] of fresh) if (!steps.some((x) => x.id === id)) steps.push(s);
    return { type: "replan", steps };
  },
};

/** §8: a ZIP of every succeeded tile, named `NN_<asset_id>.<ext>`, plus `cards.json`. */
const exportZip: ActionHandler<"listing"> = {
  method: "GET",
  path: "export",
  async run(ctx) {
    const result = await buildResult(ctx.run);
    const files: Record<string, Uint8Array> = {};
    const compose = ctx.run.steps.find((s) => s.id === COMPOSE_STEP);
    if (compose?.status === "succeeded" && compose.outputs?.length) {
      files[HERO_FILE] = await ctx.readBytes({ fromStep: COMPOSE_STEP, index: 0 });
    }
    for (const tile of result.tiles) {
      if (tile.asset === "hero" || tile.state !== "succeeded") continue;
      files[assetFileName(tile.asset)] = await ctx.readBytes({ fromStep: tile.asset, index: 0 });
    }
    if (Object.keys(files).length === 0) return { type: "error", status: 409, error: "nothing has finished yet" };
    // The manifest holds the inputs without the images (§8).
    const inputs: Record<string, unknown> = { ...ctx.run.request };
    delete inputs.productImages;
    delete inputs.logo;
    const manifest = {
      runId: ctx.run.id,
      anchorJobId: result.main?.jobId ?? null,
      inputs,
      styleBlock: result.styleBlock,
      checks: result.main?.checks ?? [],
      tiles: result.tiles
        .filter((t) => result.assets.includes(t.asset))
        .map((t) => {
          const name = t.asset === "hero" ? HERO_FILE : assetFileName(t.asset);
          return { asset: t.asset, state: t.state, seed: t.seed, file: files[name] ? name : null, missing: t.missing };
        }),
    };
    files["cards.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const zip = zipStore(files);
    return {
      type: "response",
      response: new Response(zip.buffer as ArrayBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="listing-${ctx.run.id}.zip"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    };
  },
};

export const cardsPipeline: PipelineDefinition<"listing"> = {
  kind: "listing",
  validate,
  plan,
  handlers: { [COMPOSE_STEP]: composeMainHandler, [RENDER]: renderCardHandler },
  buildResult,
  actions: { regenerate: regenerateTile, export: exportZip },
};
