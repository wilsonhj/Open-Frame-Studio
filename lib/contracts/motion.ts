/**
 * Contracts: Motion (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, OutputRef } from "./job.ts";

// ---------------------------------------------------------------------------
// Pipeline request / result
// ---------------------------------------------------------------------------

/** Values accepted by `ResolutionSelector.aspect_ratio` in h3_r2v. */
export type MotionAspect = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9";

export type MotionRequest = {
  /** `<Picture 1>`: an identity's best ref, or an uploaded person photo. One is required. */
  identityId?: string;
  personImage?: ImageRef;
  /** `<Picture 2>`. */
  productImage: ImageRef;
  /** User intent; the app adds the `<Picture N>` role tags. */
  prompt: string;
  /** Seconds, ~5–15 (snapped to the 17k+5 frame grid at 24 fps). */
  duration?: number;
  aspectRatio?: MotionAspect;
  /** `preview` = 4-step turbo LoRA; `final` = 20 base steps (default). */
  quality?: "preview" | "final";
  /** `match` (fast) or `max` (best identity, slower). */
  refFidelity?: "match" | "max";
  seed?: number;
};

export type MotionResult = {
  video: OutputRef | null;
  seed: number;
  frames: number;
};
