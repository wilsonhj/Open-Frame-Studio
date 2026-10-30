/**
 * Contracts: Product Shoot (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, JobErrorInfo, OutputRef } from "./job.ts";
import type { PipelineStepStatus } from "./pipeline.ts";

// ---------------------------------------------------------------------------
// Pipeline request / result
// ---------------------------------------------------------------------------

export type PhotoshootRequest = {
  mode: PhotoshootMode;
  /** The user's short intent, never the assembled prompt. */
  prompt: string;
  /** Product photo(s); the first is the hero. Optional only for text-only `packshot`. */
  images: ImageRef[];
  /** Clamped to the mode's range (with a notice). */
  count: number;
  /** Snapped to the whitelist (with a notice); defaults per mode. */
  aspectRatio?: AspectRatio;
  identityId?: string;
  /** Optional moodboard / "like this" reference (at most 1). */
  styleRef?: ImageRef;
  /** `fast` skips the SeedVR2 upscale. */
  quality?: "fast" | "final";
  /** packshot only: run the cutout graph on the result. */
  transparent?: boolean;
  seed?: number;
};

export type VariationPick = Record<VariationAxis, string>;

export type PhotoshootItem = {
  index: number;
  seed: number;
  status: PipelineStepStatus;
  variation: VariationPick;
  output: OutputRef | null;
  error: JobErrorInfo | null;
};

export type PhotoshootResult = {
  mode: PhotoshootMode;
  aspectRatio: AspectRatio;
  count: number;
  /** One-line user notices (count clamped, aspect snapped, Identity ignored, ...). */
  notices: string[];
  items: PhotoshootItem[];
};

// ---------------------------------------------------------------------------
// Product Shoot
// ---------------------------------------------------------------------------

export const PHOTOSHOOT_MODES = [
  "packshot",
  "in_context",
  "hands_on",
  "mood_still",
  "wide_banner",
  "carousel_set",
  "ad_variants",
  "on_model",
  "concept",
  "restage",
] as const;

export type PhotoshootMode = (typeof PHOTOSHOOT_MODES)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type VariationAxis = "preset" | "lighting" | "angle" | "palette";

export type ModeTemplate = {
  mode: PhotoshootMode;
  label: string;
  defaultAspect: AspectRatio;
  /** Subset of ASPECT_RATIOS the mode accepts. */
  aspects: readonly AspectRatio[];
  minOutputs: number;
  maxOutputs: number;
  /** Prompt template with `{product}`, `{style}`, `{lighting}`, `{angle}`, `{palette}` slots. */
  promptTemplate: string;
  variationAxes: readonly VariationAxis[];
  /** Carousel-style modes share one style lock across all outputs. */
  sharedStyle: boolean;
  /** Needs a person reference (Identity or photos). */
  needsPerson: boolean;
  // Additive (PR #1 review): MODE_TEMPLATES table columns read by the router,
  // chips and enhancer (`lib/enhancer/modes.ts`, docs/spec/photoshoot.md).
  /** Router tie-break priority; higher wins. */
  priority?: number;
  /** Keyword / intent cues the router matches. */
  cues?: readonly string[];
  /** Output count range, default and the chip values offered. */
  count?: { min: number; max: number; def: number; chips: readonly number[] };
  /** Number of identity refs fed to the graph (0 = no identity). */
  identityK?: 0 | 2 | 3;
  /** Which product image is the graph reference. */
  productRef?: "cutout" | "source" | "none";
  /** Variation value pools per axis. */
  pools?: Partial<Record<VariationAxis, readonly string[]>>;
  /** Per-output roles for style-locked sets (e.g. carousel slides). */
  roles?: readonly string[];
};
