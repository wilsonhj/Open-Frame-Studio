/**
 * Contracts: Soul ID (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, OutputRef } from "./job.ts";

// ---------------------------------------------------------------------------
// Soul ID (Instant): curated refs + style card, portable as soul.json
// ---------------------------------------------------------------------------

export const SOUL_SCHEMA = "open-soul-studio/soul@1" as const;
export const SOUL_MIN_REFS = 3;
export const SOUL_MAX_REFS = 6;

/** Pixel rectangle in the source photo (top-left origin). */
export type CropBox = { x: number; y: number; width: number; height: number };

/**
 * One curated reference. Exactly one of `assetId` (Comfy asset, server-side
 * Soul registry) or `path` (relative to soul.json, in an exported bundle).
 */
export type SoulRef = ({ assetId: string; path?: undefined } | { path: string; assetId?: undefined }) & {
  crop: CropBox;
  /** 64-bit perceptual hash, 16 lowercase hex chars; used for near-duplicate rejection. */
  phash: string;
  /**
   * SHA-256 of the ref's PNG file, 64 lowercase hex chars. Integrity check on
   * import, and (with the backend base URL) the key of the asset cache.
   */
  sha256: string;
  /** Photo-QA score 0..1 (higher is better); refs are stored best-first. */
  qaScore?: number;
};

export type StyleTrait = "skinTone" | "hair" | "eyes" | "faceShape" | "ageRange" | "accessories" | "wardrobe";

export type StyleCard = {
  /** Text block appended to every prompt that uses this Soul (≤ 400 chars). */
  description: string;
  traits: Partial<Record<StyleTrait, string>>;
  /** Features that must never change, e.g. "small mole above the left lip". */
  keep: readonly string[];
};

/** The contents of `soul.json`. */
export type Soul = {
  schema: typeof SOUL_SCHEMA;
  id: string;
  name: string;
  /** ISO-8601. */
  createdAt: string;
  /** SOUL_MIN_REFS..SOUL_MAX_REFS crops, best first. */
  refs: SoulRef[];
  styleCard: StyleCard;
};

export type SoulRequest = {
  name: string;
  /** 3–12 candidate photos; QA picks the best 3–6. */
  photos: ImageRef[];
  /** Render an identity preview sheet with klein_edit_multiref (default true). */
  preview?: boolean;
};

export type PhotoQaReason =
  | "no_face"
  | "multiple_faces"
  | "face_too_small"
  | "too_small"
  | "blurry"
  | "duplicate"
  | "unsupported_type";

export type SoulResult = {
  soul: Soul;
  /** Candidate photos not used, by index into `SoulRequest.photos`. */
  rejected: { index: number; reason: PhotoQaReason }[];
  preview: OutputRef | null;
};
