/**
 * Contracts: Listing Images (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, JobErrorInfo } from "./job.ts";
import type { AspectRatio } from "./photoshoot.ts";
import type { PipelineStepStatus } from "./pipeline.ts";
import type { CropBox } from "./identity.ts";

// ---------------------------------------------------------------------------
// Pipeline request / result
// ---------------------------------------------------------------------------

/** A tile's state: its step's status, plus `needs_input` when required copy is missing. */
export type CardTileState = PipelineStepStatus | "needs_input";

export type CardsRequest = {
  /** Default `main` when neither scope nor assets is given; `assets` wins over `scope`. */
  scope?: CardScope;
  assets?: CardAssetId[];
  /** Reuse a stored main result instead of regenerating `hero`. */
  mainJobId?: string;
  /** 1–6; the first is the hero. */
  productImages: ImageRef[];
  productName?: string;
  brandName?: string;
  category?: string;
  bullets?: string[];
  ingredients?: { name: string; amount?: string; benefit?: string }[];
  specs?: { label: string; value: string }[];
  /** 1–3 `#rrggbb`. */
  brandColors?: string[];
  visualStyle?: string;
  tagline?: string;
  logo?: ImageRef;
  boxContents?: { qty: number; name: string; imageIndex?: number }[];
  painPoints?: { problem: string; solution: string }[];
  efficacyClaims?: { value: string; label: string }[];
  efficacySource?: string;
  howToUse?: string[];
  endorsement?: { type: "review" | "expert" | "certification"; text: string; by: string; rightsConfirmed: boolean };
  identityId?: string;
  /** BCP-47. */
  language?: string;
  seed?: number;
};

export type MainImageCheck = { id: string; ok: boolean; level: "error" | "warn"; value?: number; message?: string };

export type MainImageResult = {
  jobId: string;
  compositeUrl: string;
  /** The anchor every gallery / story panel is conditioned on. */
  cutoutRgbaUrl: string;
  cutoutBbox: CropBox;
  checks: MainImageCheck[];
  ok: boolean;
};

export type CardTile = {
  asset: CardAssetId;
  state: CardTileState;
  seed: number | null;
  /** App-relative URL of the rendered card (`/api/...`). */
  url: string | null;
  /** Request fields this tile still needs (state `needs_input`). */
  missing: string[];
  error: JobErrorInfo | null;
};

export type CardsResult = {
  /** Assets in output order (main first). */
  assets: CardAssetId[];
  main: MainImageResult | null;
  tiles: CardTile[];
  styleBlock: string;
};

// ---------------------------------------------------------------------------
// Listing Images
// ---------------------------------------------------------------------------

export const CARD_ASSETS = [
  "hero",
  "gallery_callouts",
  "gallery_angles",
  "gallery_detail",
  "gallery_in_use",
  "gallery_contents",
  "story_banner",
  "story_problem_solution",
  "story_feature_grid",
  "story_materials",
  "story_results",
  "story_how_to",
  "story_social_proof",
] as const;

export type CardAssetId = (typeof CARD_ASSETS)[number];

export type CardScope = "hero" | "gallery" | "story" | "complete";

export type CardAsset = {
  id: CardAssetId;
  label: string;
  /** Every non-main asset is conditioned on the main image. */
  anchoredOnMain: boolean;
  aspect: AspectRatio;
  /** Copy rendered in code (never by diffusion). Empty for hero. */
  textSlots: readonly string[];
  scopes: readonly CardScope[];
  // Additive (PR #1 review): CARD_SPECS table columns (`lib/cards/assets.ts`,
  // docs/spec/listing.md §4.2). The planner derives steps from these.
  /** Diffusion used for this asset, if any. */
  diffusion?: "none" | "klein_edit" | "klein_t2i" | "backdrop_optional";
  /** How the product appears: pasted cutout, regenerated from ref, or absent. */
  product?: "pasted" | "regenerated" | "none";
  /** Diffusion generation size in px, or null when there is no diffusion. */
  genPx?: readonly [number, number] | null;
  /** Exported card size in px. */
  exportPx?: readonly [number, number];
  /** Request fields that must be present, else the tile is `needs_input`. */
  copyRequired?: readonly string[];
  /** Key of the pure layout function in `LAYOUTS`. */
  layout?: string;
  format?: "jpeg" | "png";
};
