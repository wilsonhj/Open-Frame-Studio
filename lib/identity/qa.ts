/**
 * Server-side photo QA (docs/spec/identity.md §4, tier B, authoritative) and
 * the head-and-shoulders crop (§5.1). CPU only: sharp for pixels, a face
 * detector (YuNet by default, injectable for tests) for Q7–Q9.
 *
 * Privacy (§8): originals are only ever held in memory here. What leaves this
 * module is the crop, re-encoded from raw pixels (no EXIF/GPS), plus numbers.
 *
 * Thresholds are the spec's starting values, marked (calibrate) there; they
 * have not been tuned on a golden face set yet (none exists).
 */
import { createHash } from "node:crypto";

import sharp from "sharp";

import type { CropBox, PhotoQaReason } from "../types.ts";
import { detectFaces, type Box, type Face, type FaceDetector } from "./detector.ts";
import type { QaWarning } from "./qa-copy.ts";

export type { QaWarning };

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** Decoded-pixel cap for user images (sharp's default is 268 MP): a decompression-bomb guard. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Only the first 20 photos of a set are processed (spec §3.3). */
export const MAX_PHOTOS = 20;
const MIN_SHORT_SIDE = 512;
const GOOD_SHORT_SIDE = 1024;
const MIN_FACE = 160;
const GOOD_FACE = 256;
const BLUR_REJECT = 60;
const BLUR_WARN = 120;
const DUPLICATE_HAMMING = 6;
const SAME_POSE_HAMMING = 12;
const CROP_LONG_SIDE = 1024;

/** Q9, by the direction the nose points in the image (not the subject's left/right). */
export type Pose = "front" | "three_quarter_left" | "three_quarter_right" | "profile";
/** Q10. */
export type Framing = "tight" | "medium" | "full_body";

export type PhotoQa = {
  /** Index into the submitted photo list. */
  index: number;
  reason: PhotoQaReason | null;
  warnings: QaWarning[];
  /** 0..1 (spec §4.1 formula); 0 when rejected before a face was measured. */
  score: number;
  width?: number;
  height?: number;
  face?: Box;
  pose?: Pose;
  framing?: Framing;
  /** Face-box mean luma (0..255) and warm/cool ratio (mean R / mean B), for selection diversity. */
  lighting?: { luma: number; warmth: number };
  sharpness?: number;
};

/** A photo that passed QA, with its crop ready to store. */
export type Candidate = PhotoQa & {
  reason: null;
  crop: CropBox;
  /** The crop as PNG (long side ≤ 1024, no metadata). */
  png: Uint8Array;
  /** SHA-256 of `png`, 64 hex. */
  sha256: string;
  /** 64-bit DCT pHash of the crop, 16 hex. */
  phash: string;
  /** SHA-256 of the decoded source pixels (exact-duplicate check only; never stored). */
  pixelSha: string;
};

export type QaOptions = {
  detect?: FaceDetector;
  /**
   * The image is a stored ref crop from a bundle, not an original: crops may
   * be under the 512 px intake minimum (§5.1 clamps to the image), so Q2 does
   * not reject it, but the face checks still run.
   */
  importedRef?: boolean;
};

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Q1: sniff magic bytes. HEIC/AVIF and everything else are unsupported. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

type Raster = { data: Uint8Array; width: number; height: number };

/** Decode with EXIF orientation applied; alpha flattened onto white. */
async function decodeRgb(bytes: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

function region(r: Raster, box: Box): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: clamp(Math.floor(box.x), 0, r.width - 1),
    y0: clamp(Math.floor(box.y), 0, r.height - 1),
    x1: clamp(Math.ceil(box.x + box.width), 1, r.width),
    y1: clamp(Math.ceil(box.y + box.height), 1, r.height),
  };
}

/** Q5 and lighting: Rec.601 mean luma, clipped share and warmth inside `box`. */
export function exposureIn(r: Raster, box: Box): { luma: number; clipped: number; warmth: number } {
  const { x0, y0, x1, y1 } = region(r, box);
  let sum = 0;
  let clipped = 0;
  let red = 0;
  let blue = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 3;
      const l = 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
      sum += l;
      if (l <= 5 || l >= 250) clipped++;
      red += r.data[i];
      blue += r.data[i + 2];
      n++;
    }
  }
  return { luma: n ? sum / n : 0, clipped: n ? clipped / n : 1, warmth: blue > 0 ? red / blue : 1 };
}

/** Variance of the 3×3 Laplacian of a greyscale raster. */
export function laplacianVariance(grey: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = grey[i - width] + grey[i + width] + grey[i - 1] + grey[i + 1] - 4 * grey[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Q4 on the face box: greyscale, short side scaled down to 512. Smaller faces
 * are measured at their own size: upscaling them softens edges and would
 * reject sharp photos as blurry.
 */
async function faceSharpness(r: Raster, box: Box): Promise<number> {
  const { x0, y0, x1, y1 } = region(r, box);
  const w = x1 - x0;
  const h = y1 - y0;
  const scale = Math.min(1, 512 / Math.min(w, h));
  const { data, info } = await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(Math.max(3, Math.round(w * scale)), Math.max(3, Math.round(h * scale)))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return laplacianVariance(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
}

/** 64-bit DCT pHash (32×32 grey → top-left 8×8 DCT → median threshold), 16 hex. */
export async function phash(image: Uint8Array | Raster): Promise<string> {
  const input = image instanceof Uint8Array ? sharp(image, { limitInputPixels: MAX_INPUT_PIXELS }) : sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
  const px = await input.resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer();
  const N = 32;
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        const cy = Math.cos(((2 * y + 1) * u * Math.PI) / (2 * N));
        for (let x = 0; x < N; x++) s += px[y * N + x] * cy * Math.cos(((2 * x + 1) * v * Math.PI) / (2 * N));
      }
      coeffs.push(s);
    }
  }
  // Median of the 63 AC terms; the DC term only carries overall brightness.
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[31];
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (coeffs[i + j] > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Q9: nose offset from the eye midpoint over eye distance (null without landmarks). */
export function yawRatio(face: Face): number | null {
  const [eyeA, eyeB, nose] = face.landmarks;
  if (!eyeA || !eyeB || !nose) return null;
  const dist = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y);
  if (dist < 1) return null;
  return (nose.x - (eyeA.x + eyeB.x) / 2) / dist;
}

export function poseOf(r: number | null): Pose {
  if (r === null) return "front";
  const a = Math.abs(r);
  if (a < 0.15) return "front";
  if (a <= 0.45) return r < 0 ? "three_quarter_left" : "three_quarter_right";
  return "profile";
}

function eyesFound(face: Face): boolean {
  const inside = (p: { x: number; y: number } | undefined) =>
    !!p && p.x >= face.box.x && p.x <= face.box.x + face.box.width && p.y >= face.box.y && p.y <= face.box.y + face.box.height;
  return inside(face.landmarks[0]) && inside(face.landmarks[1]);
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * §5.1 head-and-shoulders crop: width 2.2·fw, 4:5, face centre at 42% of the
 * height, clamped to the image (shrinking the other side rather than padding),
 * widened to a 512 short side where the image allows, and tightened towards
 * 1.6·fw when a background face would enter.
 */
export function cropFor(face: Box, width: number, height: number, background: Box[] = []): CropBox {
  const cx = face.x + face.width / 2;
  const cy = face.y + face.height / 2;
  const build = (factor: number): CropBox => {
    let w = factor * face.width;
    let h = w * 1.25;
    if (w < MIN_SHORT_SIDE) {
      w = Math.min(width, MIN_SHORT_SIDE);
      h = w * 1.25;
    }
    // Keep 4:5 inside the image: shrink whichever side overflows.
    if (h > height) {
      h = height;
      w = h / 1.25;
    }
    if (w > width) {
      w = width;
      h = Math.min(height, w * 1.25);
    }
    const x = clamp(cx - w / 2, 0, width - w);
    const y = clamp(cy - 0.42 * h, 0, height - h);
    // Round, then shrink so the box still lies inside the image. Rounding a
    // half-pixel clamp (y = 0.5, height = height - 0.5) otherwise lands one
    // pixel past the edge and sharp.extract throws.
    const rx = clamp(Math.round(x), 0, Math.max(0, width - 1));
    const ry = clamp(Math.round(y), 0, Math.max(0, height - 1));
    const rw = Math.max(1, Math.min(Math.round(w), width - rx));
    const rh = Math.max(1, Math.min(Math.round(h), height - ry));
    return { x: rx, y: ry, width: rw, height: rh };
  };
  for (let factor = 2.2; factor >= 1.6 - 1e-9; factor -= 0.1) {
    const crop = build(factor);
    if (!background.some((b) => overlaps(crop, b))) return crop;
  }
  return build(1.6);
}

/** Re-encode from raw pixels so EXIF, GPS and text chunks are dropped (§8.2). */
export async function stripMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const raster = await decodeRgb(bytes);
  const png = await sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

async function encodeCrop(r: Raster, crop: CropBox): Promise<Uint8Array> {
  const scale = Math.min(1, CROP_LONG_SIDE / Math.max(crop.width, crop.height));
  // From raw pixels: the PNG carries no EXIF, GPS or maker notes (§8.2).
  const png = await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .resize(Math.max(1, Math.round(crop.width * scale)), Math.max(1, Math.round(crop.height * scale)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

/** QA for one photo (Q1–Q10 except the set-level Q6 comparison). */
export async function checkPhoto(bytes: Uint8Array, index: number, options: QaOptions = {}): Promise<PhotoQa | Candidate> {
  const detect = options.detect ?? detectFaces;
  const result: PhotoQa = { index, reason: null, warnings: [], score: 0 };
  const reject = (reason: PhotoQaReason): PhotoQa => ({ ...result, reason });

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES || !sniffImage(bytes)) return reject("unsupported_type");
  let raster: Raster;
  try {
    raster = await decodeRgb(bytes);
  } catch {
    return reject("unsupported_type");
  }
  const { width, height } = raster;
  Object.assign(result, { width, height });
  const short = Math.min(width, height);
  if (short < MIN_SHORT_SIDE && !options.importedRef) return reject("too_small");
  if (short < GOOD_SHORT_SIDE) result.warnings.push("low_resolution");
  if (Math.max(width, height) / short > 3) result.warnings.push("wide_aspect");

  const faces = (await detect(raster.data, width, height)).filter((f) => f.score >= 0.5);
  if (faces.length === 0) return reject("no_face");
  const largest = faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
  const area = largest.box.width * largest.box.height;
  const significant = faces.filter((f) => f.box.width * f.box.height >= 0.25 * area);
  if (significant.length >= 2) return reject("multiple_faces");
  const background = faces.filter((f) => f !== largest).map((f) => f.box);
  if (background.length) result.warnings.push("background_faces");
  const faceShort = Math.min(largest.box.width, largest.box.height);
  result.face = largest.box;
  if (faceShort < MIN_FACE) return reject("face_too_small");
  if (faceShort < GOOD_FACE) result.warnings.push("small_face");

  const lap = await faceSharpness(raster, largest.box);
  result.sharpness = lap;
  if (lap < BLUR_REJECT) return reject("blurry");
  if (lap < BLUR_WARN) result.warnings.push("soft_focus");

  const exposure = exposureIn(raster, largest.box);
  if (exposure.luma < 50 || exposure.luma > 210 || exposure.clipped > 0.08) result.warnings.push("exposure");
  result.lighting = { luma: exposure.luma, warmth: exposure.warmth };
  if (!eyesFound(largest)) result.warnings.push("eyes_not_found");

  const yaw = yawRatio(largest);
  result.pose = poseOf(yaw);
  const ratio = largest.box.height / height;
  result.framing = ratio > 0.6 ? "tight" : ratio < 0.12 ? "full_body" : "medium";

  const exposureTerm = exposure.clipped > 0.08 ? 0 : 1 - Math.abs(exposure.luma - 128) / 128;
  result.score = clamp(
    0.35 * clamp((lap - BLUR_REJECT) / 240) +
      0.25 * clamp((faceShort - MIN_FACE) / 352) +
      0.15 * clamp(exposureTerm) +
      0.15 * (1 - Math.min(Math.abs(yaw ?? 0) / 0.6, 1)) +
      0.1 * clamp(largest.score),
  );

  const crop = cropFor(largest.box, width, height, background);
  const png = await encodeCrop(raster, crop);
  return {
    ...result,
    reason: null,
    crop,
    png,
    sha256: sha256(png),
    phash: await phash(png),
    pixelSha: sha256(raster.data),
  };
}

export function isCandidate(q: PhotoQa | Candidate): q is Candidate {
  return q.reason === null && "png" in q;
}

/**
 * QA for a set: each photo, then Q6 across the set (exact or near duplicates
 * reject the lower-scoring photo; a close match warns "same pose"). Photos
 * past MAX_PHOTOS are ignored. Sequential, to bound memory on large photos.
 */
export async function checkPhotos(photos: Uint8Array[], options: QaOptions = {}): Promise<(PhotoQa | Candidate)[]> {
  const results: (PhotoQa | Candidate)[] = [];
  for (let i = 0; i < Math.min(photos.length, MAX_PHOTOS); i++) results.push(await checkPhoto(photos[i], i, options));
  const passed = results.filter(isCandidate).sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const c of passed) {
    let duplicate = false;
    for (const k of kept) {
      const d = hamming(c.phash, k.phash);
      if (c.pixelSha === k.pixelSha || d <= DUPLICATE_HAMMING) {
        duplicate = true;
        break;
      }
      if (d <= SAME_POSE_HAMMING && !c.warnings.includes("same_pose")) c.warnings.push("same_pose");
    }
    if (duplicate) {
      const at = results.findIndex((r) => r.index === c.index);
      results[at] = { index: c.index, reason: "duplicate", warnings: c.warnings, score: c.score, width: c.width, height: c.height };
    } else {
      kept.push(c);
    }
  }
  return results;
}
