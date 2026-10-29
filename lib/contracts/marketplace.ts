/**
 * Contracts: Marketplace Cards (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, JobErrorInfo } from "./job.ts";
import type { AspectRatio } from "./photoshoot.ts";
import type { PipelineStepStatus } from "./pipeline.ts";
import type { CropBox } from "./soul.ts";

// ---------------------------------------------------------------------------
// Pipeline request / result
// ---------------------------------------------------------------------------

/** A tile's state: its step's status, plus `needs_input` when required copy is missing. */
export type CardTileState = PipelineStepStatus | "needs_input";

export type CardsRequest = {
  /** Default `main` when neither scope nor assets is given; `assets` wins over `scope`. */
  scope?: CardScope;
  assets?: CardAssetId[];
  /** Reuse a stored main result instead of regenerating `main_image`. */
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
  soulId?: string;
  /** BCP-47. */
  language?: string;
  seed?: number;
};

export type MainImageCheck = { id: string; ok: boolean; level: "error" | "warn"; value?: number; message?: string };

export type MainImageResult = {
  jobId: string;
  compositeUrl: string;
  /** The anchor every secondary / A+ asset is conditioned on. */
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
// Marketplace Cards
// ---------------------------------------------------------------------------

export const CARD_ASSETS = [
  "main_image",
  "infographic",
  "multi_angle",
  "detail_shot",
  "lifestyle",
  "whats_in_box",
  "aplus_hero_banner",
  "aplus_pain_points",
  "aplus_features",
  "aplus_ingredients",
  "aplus_efficacy",
  "aplus_how_to_use",
  "aplus_endorsement",
] as const;

export type CardAssetId = (typeof CARD_ASSETS)[number];

export type CardScope = "main" | "product-images" | "aplus" | "full-set";

export type CardAsset = {
  id: CardAssetId;
  label: string;
  /** Every non-main asset is conditioned on the main image. */
  anchoredOnMain: boolean;
  aspect: AspectRatio;
  /** Copy rendered in code (never by diffusion). Empty for main_image. */
  textSlots: readonly string[];
  scopes: readonly CardScope[];
};
