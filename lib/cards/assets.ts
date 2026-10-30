/**
 * CARD_SPECS: the per-asset table of docs/spec/listing.md §4.2, plus the scope
 * expansion rules R-S1–R-S4 (§2). The planner derives steps from the
 * diffusion / product / genPx / copyRequired columns; the code layout of each
 * asset is a function in `LAYOUTS` (lib/cards/layouts.ts).
 */
import type { CardAsset, CardAssetId, CardScope, CardsRequest } from "../types.ts";
import { CARD_ASSETS } from "../types.ts";
import { SQUARE_GEN_PX, SQUARE_PX, STORY_GEN_PX, STORY_PX } from "./sizes.ts";

const GALLERY: readonly CardScope[] = ["gallery", "complete"];
const STORY: readonly CardScope[] = ["story", "complete"];

/**
 * Story panels are ~2.44:1. `AspectRatio` has no such value, so they carry the
 * nearest ("16:9"); `exportPx` is the real size.
 */
export const CARD_SPECS: Record<CardAssetId, CardAsset> = {
  hero: {
    id: "hero",
    label: "Hero image",
    anchoredOnMain: false,
    aspect: "1:1",
    textSlots: [],
    scopes: ["hero", "gallery", "story", "complete"],
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: SQUARE_PX,
    copyRequired: [],
    layout: "hero",
    format: "png",
  },
  gallery_callouts: {
    id: "gallery_callouts",
    label: "Callouts",
    anchoredOnMain: true,
    aspect: "1:1",
    textSlots: ["productName", "bullets"],
    scopes: GALLERY,
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: SQUARE_PX,
    copyRequired: ["productName", "bullets"],
    layout: "callouts",
    format: "png",
  },
  gallery_angles: {
    id: "gallery_angles",
    label: "Angles",
    anchoredOnMain: true,
    aspect: "1:1",
    textSlots: [],
    scopes: GALLERY,
    diffusion: "klein_edit",
    product: "regenerated",
    genPx: SQUARE_GEN_PX,
    exportPx: SQUARE_PX,
    copyRequired: [],
    layout: "angles",
    format: "jpeg",
  },
  gallery_detail: {
    id: "gallery_detail",
    label: "Detail",
    anchoredOnMain: true,
    aspect: "1:1",
    textSlots: ["specs"],
    scopes: GALLERY,
    diffusion: "klein_edit",
    product: "regenerated",
    genPx: SQUARE_GEN_PX,
    exportPx: SQUARE_PX,
    copyRequired: [],
    layout: "detail",
    format: "jpeg",
  },
  gallery_in_use: {
    id: "gallery_in_use",
    label: "In use",
    anchoredOnMain: true,
    aspect: "1:1",
    textSlots: [],
    scopes: GALLERY,
    diffusion: "klein_edit",
    product: "regenerated",
    genPx: SQUARE_GEN_PX,
    exportPx: SQUARE_PX,
    copyRequired: [],
    layout: "full_bleed",
    format: "jpeg",
  },
  gallery_contents: {
    id: "gallery_contents",
    label: "Contents",
    anchoredOnMain: true,
    aspect: "1:1",
    textSlots: ["boxContents"],
    scopes: GALLERY,
    diffusion: "klein_edit",
    product: "regenerated",
    genPx: SQUARE_GEN_PX,
    exportPx: SQUARE_PX,
    copyRequired: ["boxContents"],
    layout: "contents",
    format: "jpeg",
  },
  story_banner: {
    id: "story_banner",
    label: "Story banner",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["brandName", "productName", "tagline"],
    scopes: STORY,
    diffusion: "klein_edit",
    product: "regenerated",
    genPx: STORY_GEN_PX,
    exportPx: STORY_PX,
    copyRequired: ["productName"],
    layout: "banner",
    format: "jpeg",
  },
  story_problem_solution: {
    id: "story_problem_solution",
    label: "Problem / solution",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["painPoints"],
    scopes: STORY,
    diffusion: "klein_t2i",
    product: "none",
    genPx: STORY_GEN_PX,
    exportPx: STORY_PX,
    copyRequired: ["painPoints"],
    layout: "problem_solution",
    format: "jpeg",
  },
  story_feature_grid: {
    id: "story_feature_grid",
    label: "Feature grid",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["bullets"],
    scopes: STORY,
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: STORY_PX,
    copyRequired: ["bullets"],
    layout: "feature_grid",
    format: "png",
  },
  story_materials: {
    id: "story_materials",
    label: "Materials",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["ingredients", "specs"],
    scopes: STORY,
    diffusion: "klein_t2i",
    product: "pasted",
    genPx: STORY_GEN_PX,
    exportPx: STORY_PX,
    copyRequired: ["ingredients|specs"],
    layout: "materials",
    format: "jpeg",
  },
  story_results: {
    id: "story_results",
    label: "Results",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["efficacyClaims", "efficacySource"],
    scopes: STORY,
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: STORY_PX,
    copyRequired: ["efficacyClaims", "efficacySource"],
    layout: "results",
    format: "png",
  },
  story_how_to: {
    id: "story_how_to",
    label: "How to",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["howToUse"],
    scopes: STORY,
    // §4.2 allows numbered icons when diffusion is off; v1 ships that variant.
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: STORY_PX,
    copyRequired: ["howToUse"],
    layout: "how_to",
    format: "png",
  },
  story_social_proof: {
    id: "story_social_proof",
    label: "Social proof",
    anchoredOnMain: true,
    aspect: "16:9",
    textSlots: ["endorsement"],
    scopes: STORY,
    diffusion: "none",
    product: "pasted",
    genPx: null,
    exportPx: STORY_PX,
    copyRequired: ["endorsement"],
    layout: "social_proof",
    format: "png",
  },
};

/** NN in `NN_<asset_id>.<ext>` (G6): the asset's position in §2 order, 1-based. */
export function assetOrder(asset: CardAssetId): number {
  return CARD_ASSETS.indexOf(asset) + 1;
}

export function assetFileName(asset: CardAssetId): string {
  const ext = CARD_SPECS[asset].format === "png" ? "png" : "jpg";
  return `${String(assetOrder(asset)).padStart(2, "0")}_${asset}.${ext}`;
}

/**
 * R-S1–R-S4: `assets[]` wins over `scope`; neither means `hero`; `hero` is
 * always added first; duplicates dropped; output in §2 order.
 */
export function expandAssets(request: Pick<CardsRequest, "scope" | "assets">): CardAssetId[] {
  const wanted = new Set<CardAssetId>(["hero"]);
  if (request.assets && request.assets.length > 0) {
    for (const a of request.assets) wanted.add(a);
  } else {
    const scope = request.scope ?? "hero";
    for (const a of CARD_ASSETS) if (CARD_SPECS[a].scopes.includes(scope)) wanted.add(a);
  }
  return CARD_ASSETS.filter((a) => wanted.has(a));
}

/**
 * G7: the request fields this asset still needs. `a|b` means either one.
 * An endorsement without `rightsConfirmed` counts as missing (T-T4).
 */
export function missingCopy(asset: CardAssetId, request: CardsRequest): string[] {
  const present = (field: string): boolean => {
    const v = (request as Record<string, unknown>)[field];
    if (field === "endorsement") {
      const e = request.endorsement;
      return !!e && e.rightsConfirmed === true && e.text.trim() !== "" && e.by.trim() !== "";
    }
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
  };
  return (CARD_SPECS[asset].copyRequired ?? []).filter((f) => !f.split("|").some(present));
}
