#!/usr/bin/env node
/**
 * Generate procedural placeholder fixtures (pure Node: zlib + a tiny PNG encoder, no deps).
 *
 *   node scripts/make-fixtures.mjs            # writes fixtures/products/*.png
 *   node scripts/make-fixtures.mjs --check    # exit 1 if any fixture is missing or differs
 *
 * Output is deterministic (seeded PRNG), so re-running produces byte-identical files.
 *
 * Products: plain synthetic shapes (bottle, mug, box) on deliberately busy backgrounds, so
 * cutout / background-removal and "pure white main image" steps have something to do.
 *
 * Faces: NONE. This script never draws or fetches faces. The Identity face set is either
 * AI-generated on Comfy Cloud later, or supplied by a consenting person (see fixtures/README.md).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures", "products");
const SIZE = 512;

// ---------------------------------------------------------------------------
// PNG encoder (8-bit RGB, filter 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tiny shading helpers (signed distance fields, anti-aliased by 1px smoothstep)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** Coverage of a shape from its signed distance (negative inside). */
const cover = (d) => clamp(0.5 - d);
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const sdEllipse = (x, y, cx, cy, rx, ry) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
function sdRoundBox(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const shade = (c, k) => c.map((v) => v * k);

function render(shader) {
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = shader(x + 0.5, y + 0.5);
      const i = (y * SIZE + x) * 3;
      rgb[i] = clamp(Math.round(c[0]), 0, 255);
      rgb[i + 1] = clamp(Math.round(c[1]), 0, 255);
      rgb[i + 2] = clamp(Math.round(c[2]), 0, 255);
    }
  }
  return encodePng(SIZE, SIZE, rgb);
}

// ---------------------------------------------------------------------------
// Busy backgrounds
// ---------------------------------------------------------------------------

function confettiBackground(seed) {
  const rand = mulberry32(seed);
  const palette = [
    [236, 64, 122],
    [41, 182, 246],
    [255, 202, 40],
    [102, 187, 106],
    [171, 71, 188],
    [255, 112, 67],
  ];
  const dots = Array.from({ length: 140 }, () => ({
    x: rand() * SIZE,
    y: rand() * SIZE,
    r: 6 + rand() * 22,
    c: palette[Math.floor(rand() * palette.length)],
  }));
  return (x, y) => {
    const stripe = Math.floor((x + y) / 18) % 2 === 0;
    let c = stripe ? [245, 236, 220] : [214, 200, 182];
    for (const d of dots) {
      const k = cover(sdCircle(x, y, d.x, d.y, d.r));
      if (k > 0) c = mix(c, d.c, k);
    }
    return c;
  };
}

function tilesBackground() {
  return (x, y) => {
    const a = Math.sin(x / 9) * 0.5 + 0.5;
    const b = Math.sin(y / 13) * 0.5 + 0.5;
    const band = (Math.floor(x / 64) + Math.floor(y / 64)) % 2;
    const base = band ? [38, 70, 83] : [42, 157, 143];
    return mix(base, [233, 196, 106], (a * b) ** 3);
  };
}

function checkerLeafBackground(seed) {
  const rand = mulberry32(seed);
  const leaves = Array.from({ length: 60 }, () => ({
    x: rand() * SIZE,
    y: rand() * SIZE,
    rx: 10 + rand() * 30,
    ry: 4 + rand() * 10,
    c: rand() > 0.5 ? [46, 125, 50] : [130, 119, 23],
  }));
  return (x, y) => {
    const cell = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
    let c = cell ? [250, 250, 245] : [30, 30, 36];
    for (const l of leaves) {
      const k = cover(sdEllipse(x, y, l.x, l.y, l.rx, l.ry));
      if (k > 0) c = mix(c, l.c, k);
    }
    return c;
  };
}

/** Composite: background, soft drop shadow, then the product (sd + colour function). */
function scene(background, product, shadowOffset = [14, 18]) {
  return (x, y) => {
    let c = background(x, y);
    const sd = product.sd(x - shadowOffset[0], y - shadowOffset[1]);
    const shadow = clamp(1 - Math.max(sd, 0) / 22) * 0.45;
    if (shadow > 0) c = shade(c, 1 - shadow);
    const d = product.sd(x, y);
    const k = cover(d);
    if (k > 0) c = mix(c, product.color(x, y), k);
    return c;
  };
}

// ---------------------------------------------------------------------------
// Products (no text, no logos, no people)
// ---------------------------------------------------------------------------

const C = SIZE / 2;

const bottle = {
  sd: (x, y) =>
    Math.min(
      sdRoundBox(x, y, C, C + 40, 78, 150, 34), // body
      sdRoundBox(x, y, C, C - 128, 30, 30, 8), // neck
      sdRoundBox(x, y, C, C - 168, 36, 18, 6), // cap
    ),
  color: (x, y) => {
    if (y < C - 150) return [30, 30, 30]; // cap
    const light = 0.75 + 0.35 * Math.cos(((x - C) / 78) * 1.2 + 0.5);
    const label = y > C + 10 && y < C + 110 ? [250, 245, 235] : [200, 40, 50];
    return shade(label, light);
  },
};

const mug = {
  sd: (x, y) => {
    const body = sdRoundBox(x, y, C - 30, C + 20, 110, 130, 18);
    const handleOuter = sdEllipse(x, y, C + 95, C + 20, 70, 80);
    const handleInner = sdEllipse(x, y, C + 95, C + 20, 42, 52);
    const handle = Math.max(handleOuter, -handleInner);
    return Math.min(body, handle);
  },
  color: (x, y) => {
    const light = 0.7 + 0.4 * Math.cos(((x - (C - 30)) / 110) * 1.3 + 0.4);
    const band = Math.abs(y - (C + 20)) < 18 ? [255, 255, 255] : [25, 118, 210];
    return shade(band, light);
  },
};

const box = {
  sd: (x, y) => sdRoundBox(x, y, C, C + 10, 150, 120, 6),
  color: (x, y) => {
    const top = y < C - 70;
    const side = x > C + 90;
    const base = [255, 179, 0];
    if (top) return shade(base, 1.08);
    if (side) return shade(base, 0.78);
    const stripe = Math.abs(x - (C - 30)) < 16 ? [255, 255, 255] : base;
    return stripe;
  },
};

const FIXTURES = [
  { file: "product-bottle-confetti.png", shader: scene(confettiBackground(7), bottle) },
  { file: "product-mug-tiles.png", shader: scene(tilesBackground(), mug) },
  { file: "product-box-checker.png", shader: scene(checkerLeafBackground(42), box) },
];

// ---------------------------------------------------------------------------

const check = process.argv.includes("--check");
mkdirSync(OUT, { recursive: true });
let stale = 0;
for (const { file, shader } of FIXTURES) {
  const path = join(OUT, file);
  const png = render(shader);
  const rel = relative(ROOT, path);
  if (check) {
    const same = existsSync(path) && readFileSync(path).equals(png);
    if (!same) stale += 1;
    console.log(`${same ? "ok   " : "STALE"} ${rel}`);
  } else {
    writeFileSync(path, png);
    console.log(`wrote ${rel} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KiB)`);
  }
}
if (check && stale) {
  console.error(`${stale} fixture(s) missing or out of date: run node scripts/make-fixtures.mjs`);
  process.exit(1);
}
