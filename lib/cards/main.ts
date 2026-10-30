/**
 * Deterministic marketplace hero image on pure white (docs/spec/listing.md §4)
 * and its compliance checks A1–A7 and C3 (§5). Pure functions over bytes; sharp only.
 *
 * Port of spikes/cutout-upscale/marketplace_main.py.
 */
import type { CropBox, MainImageCheck } from "../types.ts";

/** sharp is imported lazily so loading the pipeline registry never pulls in libvips. */
async function loadSharp() {
  return (await import("sharp")).default;
}

export const MAIN_SIZE = 2000;
export const MAIN_FILL = 0.85;
export const ALPHA_FLOOR = 8;
const BORDER_BAND = 20;
/** C3: how far (px) visible product pixels may stray outside the placed box. */
const PLACE_TOLERANCE = 2;

export type CutoutStats = {
  width: number;
  height: number;
  /** Alpha bbox (alpha ≥ ALPHA_FLOOR) in cutout pixels. */
  bbox: CropBox;
  /** A4: share of the bbox with alpha < ALPHA_FLOOR. */
  transparentFraction: number;
  /** A5: connected components (8-connectivity) larger than 2% of the alpha area. */
  components: number;
  /** A7: share of product pixels with min(R,G,B) ≥ 245. */
  nearWhiteFraction: number;
};

export type ComposeMainResult = {
  /** 2000×2000 RGB PNG on pure #FFFFFF. */
  png: Uint8Array;
  cutout: CutoutStats;
  /** Where the scaled product was placed on the canvas. */
  placed: CropBox;
};

/** Measure an RGBA cutout: alpha bbox, real transparency, components, near-white share. */
export async function analyzeCutout(cutoutPng: Uint8Array): Promise<CutoutStats> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(cutoutPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let solid = 0;
  let nearWhite = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i + 3] < ALPHA_FLOOR) continue;
      solid++;
      if (Math.min(data[i], data[i + 1], data[i + 2]) >= 245) nearWhite++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("cutout has an empty alpha channel");
  const bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const bboxArea = bbox.width * bbox.height;
  return {
    width,
    height,
    bbox,
    transparentFraction: (bboxArea - solid) / bboxArea,
    components: countComponents(data, width, channels, bbox, solid),
    nearWhiteFraction: nearWhite / solid,
  };
}

/** Connected components of alpha ≥ floor (8-connectivity) larger than 2% of the alpha area. */
function countComponents(data: Uint8Array, width: number, channels: number, bbox: CropBox, solid: number): number {
  const seen = new Uint8Array(bbox.width * bbox.height);
  const stack = new Int32Array(bbox.width * bbox.height);
  const isSolid = (lx: number, ly: number) => data[((bbox.y + ly) * width + bbox.x + lx) * channels + 3] >= ALPHA_FLOOR;
  const minSize = 0.02 * solid;
  let count = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isSolid(start % bbox.width, Math.floor(start / bbox.width))) continue;
    seen[start] = 1;
    let top = 0;
    stack[top++] = start;
    let size = 0;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const px = p % bbox.width;
      const py = (p - px) / bbox.width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= bbox.width || ny >= bbox.height) continue;
          const q = ny * bbox.width + nx;
          if (seen[q] || !isSolid(nx, ny)) continue;
          seen[q] = 1;
          stack[top++] = q;
        }
      }
    }
    if (size > minSize) count++;
  }
  return count;
}

/** Trim to the alpha bbox, scale the longest side to 85% of 2000 px, centre on pure white. */
export async function composeMain(cutoutPng: Uint8Array): Promise<ComposeMainResult> {
  const sharp = await loadSharp();
  const cutout = await analyzeCutout(cutoutPng);
  const { bbox } = cutout;
  const scale = (MAIN_FILL * MAIN_SIZE) / Math.max(bbox.width, bbox.height);
  const w = Math.max(1, Math.round(bbox.width * scale));
  const h = Math.max(1, Math.round(bbox.height * scale));
  const product = await sharp(cutoutPng)
    .ensureAlpha()
    .extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const placed = { x: Math.floor((MAIN_SIZE - w) / 2), y: Math.floor((MAIN_SIZE - h) / 2), width: w, height: h };
  const composite = await sharp({
    create: { width: MAIN_SIZE, height: MAIN_SIZE, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: product, left: placed.x, top: placed.y }])
    .png()
    .toBuffer();
  // Re-encode from raw RGB so the written file is guaranteed 3-channel sRGB.
  const flat = await sharp(composite).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer();
  const png = await sharp(flat, { raw: { width: MAIN_SIZE, height: MAIN_SIZE, channels: 3 } })
    .toColorspace("srgb")
    .png()
    .toBuffer();
  return { png: new Uint8Array(png), cutout, placed };
}

const round = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Run A1–A7 and C3 on the written main image (and the cutout it was composed
 * from). A2 measures the product's alpha box as placed on the canvas (spec
 * §5.1: the bbox comes from alpha ≥ 8), so a product with pure-white edges (a
 * white cap, sole or label) is not mistaken for background. Without `placed`,
 * A2 falls back to the bbox of non-white pixels in the flattened file.
 *
 * C3 (§5 "Centred, not cropped": A1 plus a bbox-inside-canvas assertion) is
 * measured from the written pixels, so it catches a composite that does not
 * match its claimed placement: the placed box is centred and clear of every
 * edge, some product is visible, and no visible (non-white) pixel lies more
 * than PLACE_TOLERANCE px outside the placed box. Visible pixels may sit
 * inside it (white product edges blend into the background), never outside.
 */
export async function checkMain(mainPng: Uint8Array, cutout: CutoutStats, placed?: CropBox): Promise<MainImageCheck[]> {
  const sharp = await loadSharp();
  const meta = await sharp(mainPng).metadata();
  const { data, info } = await sharp(mainPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let border = 0;
  let borderWhite = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const white = data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255;
      if (x < BORDER_BAND || y < BORDER_BAND || x >= width - BORDER_BAND || y >= height - BORDER_BAND) {
        border++;
        if (white) borderWhite++;
      }
      if (!white) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const borderWhiteness = border ? borderWhite / border : 0;
  const fill = placed
    ? Math.max(placed.width, placed.height) / Math.max(width, height)
    : maxX < 0
      ? 0
      : Math.max(maxX - minX + 1, maxY - minY + 1) / Math.max(width, height);
  const measured = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const box = placed ?? measured;
  const margin = box ? Math.min(box.x, box.y, width - (box.x + box.width), height - (box.y + box.height)) : 0;
  const centred = box ? Math.abs(box.x + box.width / 2 - width / 2) <= 1 && Math.abs(box.y + box.height / 2 - height / 2) <= 1 : false;
  const agrees =
    !!box &&
    !!measured &&
    measured.x >= box.x - PLACE_TOLERANCE &&
    measured.y >= box.y - PLACE_TOLERANCE &&
    measured.x + measured.width <= box.x + box.width + PLACE_TOLERANCE &&
    measured.y + measured.height <= box.y + box.height + PLACE_TOLERANCE;
  const sizeOk = width === MAIN_SIZE && height === MAIN_SIZE && meta.channels === 3 && !meta.hasAlpha;
  const sourcePx = Math.max(cutout.bbox.width, cutout.bbox.height);

  return [
    {
      id: "A1",
      level: "error",
      ok: borderWhiteness >= 0.99,
      value: round(borderWhiteness),
      message: "Border band is pure #FFFFFF (≥ 0.99)",
    },
    { id: "A2", level: "error", ok: Math.abs(fill - MAIN_FILL) <= 0.01, value: round(fill), message: "Product fills 85% ± 1%" },
    {
      id: "A3",
      level: "error",
      ok: sizeOk,
      value: width,
      message: `Canvas ${width}×${height}, ${meta.channels} channels (need 2000×2000 RGB)`,
    },
    {
      id: "A4",
      level: "error",
      ok: cutout.transparentFraction >= 0.05,
      value: round(cutout.transparentFraction),
      message: "Cutout has real transparency (≥ 0.05 of its bbox)",
    },
    {
      id: "A5",
      level: "warn",
      ok: cutout.components === 1,
      value: cutout.components,
      message: "Single product (one significant shape)",
    },
    { id: "A6", level: "error", ok: sourcePx >= 425, value: sourcePx, message: "Source product ≥ 425 px on its longest side" },
    {
      id: "A7",
      level: "warn",
      ok: cutout.nearWhiteFraction <= 0.6,
      value: round(cutout.nearWhiteFraction),
      message: "Product visible on white (≤ 0.6 near-white pixels)",
    },
    {
      id: "C3",
      level: "error",
      ok: margin > 0 && centred && agrees,
      value: margin,
      message: "Product centred inside the canvas, not cropped (value: smallest edge margin, px)",
    },
  ];
}

/** `ok` = every error-level check passed (warnings never block). */
export function mainOk(checks: readonly MainImageCheck[]): boolean {
  return checks.every((c) => c.ok || c.level === "warn");
}
