/**
 * Demo-only placeholder renderer (slice G): a product-photo-like PNG from an
 * uploaded image — gradient studio backdrop, floor line, soft contact shadow
 * and the product composited in the middle. No model involved.
 */
import sharp from "sharp";

const SIZE = 1024;

/** [top, bottom, floor] backdrop palettes; picked per frame for variety. */
const PALETTES = [
  ["#f4efe6", "#d9cbb4", "#cdbb9f"], // warm paper
  ["#e9eef2", "#b9c7d3", "#a8b8c6"], // cool studio grey-blue
  ["#f6e3d8", "#e0a88c", "#d39678"], // terracotta
  ["#e6efe8", "#a9c5b4", "#94b3a0"], // sage
  ["#262321", "#4a4440", "#3a3532"], // low-key charcoal
  ["#f5ecd2", "#e1c27a", "#d4b066"], // honey
];

function backdropSvg([top, bottom, floor], variant) {
  if (variant === "cutout") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bottom}"/><stop offset="1" stop-color="${floor}"/>
    </linearGradient>
    <radialGradient id="light" cx="0.35" cy="0.25" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#wall)"/>
  <rect y="${SIZE * 0.68}" width="100%" height="${SIZE * 0.32}" fill="url(#floor)"/>
  <rect width="100%" height="100%" fill="url(#light)"/>
</svg>`;
}

function shadowSvg(width, dark) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <ellipse cx="${SIZE / 2}" cy="${SIZE * 0.79}" rx="${width * 0.5}" ry="${SIZE * 0.035}" fill="#000" fill-opacity="${dark ? 0.55 : 0.28}"/>
</svg>`;
}

/** A styled stand-in product (a bottle) when the job has no image input. */
function placeholderProduct(seed) {
  const hues = ["#2e7d6b", "#d9431e", "#a86b12", "#3b4a6b", "#7a2e4f"];
  const body = hues[seed % hues.length];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
  <rect x="140" y="0" width="80" height="110" rx="10" fill="#1b1a17"/>
  <rect x="40" y="100" width="280" height="540" rx="60" fill="${body}"/>
  <rect x="40" y="100" width="280" height="540" rx="60" fill="url(#g)"/>
  <rect x="80" y="300" width="200" height="140" rx="8" fill="#fbf9f4"/>
  <text x="180" y="380" font-family="Georgia, serif" font-size="28" text-anchor="middle" fill="#1b1a17">OPEN SOUL</text>
</svg>`);
}

/**
 * @param {{ source: Buffer | null, seed: number, index: number, variant?: "shot" | "cutout" }} options
 * @returns {Promise<Buffer>} PNG bytes (1024x1024)
 */
export async function renderFrame({ source, seed, index, variant = "shot" }) {
  const palette = PALETTES[(Math.abs(seed) + index) % PALETTES.length];
  const dark = palette === PALETTES[4];
  const maxW = Math.round(SIZE * 0.56);
  const maxH = Math.round(SIZE * 0.6);

  let product;
  try {
    product = await sharp(source ?? placeholderProduct(Math.abs(seed)))
      .rotate()
      .resize({ width: maxW, height: maxH, fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    product = await sharp(placeholderProduct(Math.abs(seed))).resize({ width: maxW, height: maxH, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  }
  const { width, height } = product.info;
  // Round the corners so a rectangular photo reads as a placed print/object.
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${Math.round(Math.min(width, height) * 0.04)}"/></svg>`,
  );
  const rounded = await sharp(product.data).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const top = Math.round(SIZE * 0.79 - height);
  const left = Math.round((SIZE - width) / 2);

  const layers = [];
  if (variant !== "cutout") {
    layers.push({ input: await sharp(Buffer.from(shadowSvg(width, dark))).blur(18).png().toBuffer(), top: 0, left: 0 });
  }
  layers.push({ input: rounded, top: Math.max(0, top), left });

  return sharp(Buffer.from(backdropSvg(palette, variant))).composite(layers).png().toBuffer();
}
