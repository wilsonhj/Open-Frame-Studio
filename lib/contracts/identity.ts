/**
 * Contracts: Identity (part of the frozen Wave 1 contract; barrel:
 * lib/types.ts). No runtime dependencies.
 */
import type { ImageRef, OutputRef } from "./job.ts";

// ---------------------------------------------------------------------------
// Identity (Instant): curated refs + style card, portable as identity.json
// ---------------------------------------------------------------------------

export const IDENTITY_SCHEMA = "open-frame-studio/identity@1" as const;
export const IDENTITY_MIN_REFS = 3;
export const IDENTITY_MAX_REFS = 6;

/** Pixel rectangle in the source photo (top-left origin). */
export type CropBox = { x: number; y: number; width: number; height: number };

/**
 * One curated reference. Exactly one of `assetId` (Comfy asset, server-side
 * identity registry) or `path` (relative to identity.json, in an exported bundle).
 */
export type IdentityRef = ({ assetId: string; path?: undefined } | { path: string; assetId?: undefined }) & {
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
  /** Text block appended to every prompt that uses this identity (≤ 400 chars). */
  description: string;
  traits: Partial<Record<StyleTrait, string>>;
  /** Features that must never change, e.g. "small mole above the left lip". */
  keep: readonly string[];
};

/** The contents of `identity.json`. */
export type Identity = {
  schema: typeof IDENTITY_SCHEMA;
  id: string;
  name: string;
  /** ISO-8601. */
  createdAt: string;
  /** IDENTITY_MIN_REFS..IDENTITY_MAX_REFS crops, best first. */
  refs: IdentityRef[];
  styleCard: StyleCard;
};

export type IdentityRequest = {
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

export type IdentityResult = {
  identity: Identity;
  /** Candidate photos not used, by index into `IdentityRequest.photos`. */
  rejected: { index: number; reason: PhotoQaReason }[];
  preview: OutputRef | null;
};
