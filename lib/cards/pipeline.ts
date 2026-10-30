/**
 * Marketplace Cards pipeline (slice E). Demo scope: the deterministic main
 * image only — `cutout` (Comfy) → `compose_main` (code: compose + A1–A7).
 * Every other asset is reported as a skipped tile for now.
 */
import type { CodeHandler, PipelineDefinition, ValidateResult } from "../pipeline/types.ts";
import type {
  CardsRequest,
  CardTile,
  CropBox,
  ImageRef,
  JsonValue,
  MainImageCheck,
  MainImageResult,
  PipelineStep,
  StepInputRef,
} from "../types.ts";
import { CARD_ASSETS, DEFAULT_STEP_TIMEOUT_MS } from "../types.ts";
import { checkMain, composeMain, mainOk } from "./main.ts";

const CUTOUT_STEP = "cutout";
const COMPOSE_STEP = "compose_main";
const CUTOUT_OUTPUT_NODE = "18";

function isImageRef(v: unknown): v is ImageRef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (typeof o.upload === "string" && o.upload !== "") || (typeof o.assetId === "string" && o.assetId !== "");
}

function validate(raw: unknown): ValidateResult<CardsRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "request must be an object", field: "" };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.productImages) || r.productImages.length < 1 || r.productImages.length > 6) {
    return { ok: false, error: "productImages must hold 1–6 images", field: "productImages" };
  }
  for (const [i, img] of r.productImages.entries()) {
    if (!isImageRef(img)) return { ok: false, error: "expected { upload } or { assetId }", field: `productImages[${i}]` };
  }
  if (r.productName !== undefined && typeof r.productName !== "string") {
    return { ok: false, error: "productName must be a string", field: "productName" };
  }
  if (r.scope !== undefined && r.scope !== "main") {
    return { ok: false, error: "only scope \"main\" is available right now", field: "scope" };
  }
  const productImages = r.productImages as ImageRef[];
  const value: CardsRequest = { scope: "main", productImages };
  if (typeof r.productName === "string" && r.productName.trim()) value.productName = r.productName.trim();
  return { ok: true, value };
}

const composeMainHandler: CodeHandler<"cards"> = async (ctx) => {
  const source = ctx.step.inputs.cutout as StepInputRef;
  const bytes = await ctx.readBytes(source);
  const { png, cutout, placed } = await composeMain(bytes);
  const checks = await checkMain(png, cutout);
  return {
    files: [{ name: "main.png", contentType: "image/png", bytes: png }],
    data: { checks, ok: mainOk(checks), cutoutBbox: cutout.bbox, placed } as unknown as JsonValue,
  };
};

type ComposeData = { checks: MainImageCheck[]; ok: boolean; cutoutBbox: CropBox };

export const cardsPipeline: PipelineDefinition<"cards"> = {
  kind: "cards",
  validate,
  async plan(request) {
    const hero = request.productImages[0];
    if (!hero || !("assetId" in hero)) throw new Error("productImages[0] must be uploaded before planning");
    const steps: PipelineStep[] = [
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
        inputs: { cutout: { fromStep: CUTOUT_STEP, outputNode: CUTOUT_OUTPUT_NODE } },
        timeoutMs: 60_000,
        status: "pending",
      },
    ];
    return steps;
  },
  handlers: { [COMPOSE_STEP]: composeMainHandler },
  async buildResult(run) {
    const cutoutStep = run.steps.find((s) => s.id === CUTOUT_STEP);
    const composeStep = run.steps.find((s) => s.id === COMPOSE_STEP);
    const data = composeStep?.data as ComposeData | undefined;
    const compositeUrl = composeStep?.outputs?.[0]?.url ?? null;
    const cutoutOut =
      cutoutStep?.outputs?.find((o) => o.nodeId === CUTOUT_OUTPUT_NODE) ?? cutoutStep?.outputs?.[0] ?? null;

    const main: MainImageResult | null =
      composeStep?.status === "succeeded" && data && compositeUrl
        ? {
            jobId: cutoutStep?.jobId ?? run.id,
            compositeUrl,
            cutoutRgbaUrl: cutoutOut?.url ?? "",
            cutoutBbox: data.cutoutBbox,
            checks: data.checks,
            ok: data.ok,
          }
        : null;

    const mainState = composeStep?.status === "pending" && cutoutStep ? cutoutStep.status : (composeStep?.status ?? "pending");
    const tiles: CardTile[] = CARD_ASSETS.map((asset) =>
      asset === "main_image"
        ? {
            asset,
            state: mainState,
            seed: null,
            url: main?.compositeUrl ?? null,
            missing: [],
            error: composeStep?.error ?? cutoutStep?.error ?? null,
          }
        : { asset, state: "skipped", seed: null, url: null, missing: [], error: null },
    );
    return { assets: ["main_image"], main, tiles, styleBlock: "" };
  },
};
