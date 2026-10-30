import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import type { MainImageCheck } from "../../lib/types.ts";

import { analyzeCutout, checkMain, composeMain, mainOk } from "../../lib/cards/main.ts";

type Rect = { x: number; y: number; w: number; h: number; rgb: [number, number, number] };

/** Transparent canvas with opaque rectangles (a synthetic RGBA cutout). */
async function rgba(width: number, height: number, rects: Rect[]): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 4);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        data[i] = r.rgb[0];
        data[i + 1] = r.rgb[1];
        data[i + 2] = r.rgb[2];
        data[i + 3] = 255;
      }
    }
  }
  return new Uint8Array(await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

/** A diamond-ish product: a tall bar plus a wide bar (bbox has real transparency). */
const product = () =>
  rgba(800, 900, [
    { x: 300, y: 100, w: 200, h: 700, rgb: [40, 60, 120] },
    { x: 150, y: 350, w: 500, h: 200, rgb: [200, 30, 30] },
  ]);

const byId = (checks: MainImageCheck[], id: string) => checks.find((c) => c.id === id)!;

describe("composeMain", () => {
  it("trims, scales to 85% and centres on a 2000×2000 RGB white canvas", async () => {
    const { png, cutout, placed } = await composeMain(await product());
    assert.deepEqual(cutout.bbox, { x: 150, y: 100, width: 500, height: 700 });
    assert.equal(placed.height, 1700);
    assert.equal(placed.x, Math.floor((2000 - placed.width) / 2));
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 2000);
    assert.equal(meta.height, 2000);
    assert.equal(meta.channels, 3);
    assert.equal(meta.hasAlpha, false);
  });

  it("passes A1–A7 and C3 for a real cutout", async () => {
    const { png, cutout } = await composeMain(await product());
    const checks = await checkMain(png, cutout);
    assert.deepEqual(
      checks.map((c) => c.id),
      ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "C3"],
    );
    for (const c of checks) assert.ok(c.ok, `${c.id} failed: ${c.value}`);
    assert.ok(mainOk(checks));
    assert.ok(Math.abs(byId(checks, "A2").value! - 0.85) <= 0.01);
  });
});

describe("A2 fill uses the placed alpha box", () => {
  it("a product with pure-white outer rows still fills 85%", async () => {
    // Opaque 400×800 product whose top 200 rows are pure #FFFFFF (a white cap).
    const capped = await rgba(400, 800, [
      { x: 0, y: 0, w: 400, h: 200, rgb: [255, 255, 255] },
      { x: 0, y: 200, w: 400, h: 600, rgb: [30, 90, 160] },
    ]);
    const { png, cutout, placed } = await composeMain(capped);
    const withPlaced = await checkMain(png, cutout, placed);
    assert.equal(byId(withPlaced, "A2").ok, true, `A2 ${byId(withPlaced, "A2").value}`);
    assert.ok(Math.abs(byId(withPlaced, "A2").value! - 0.85) <= 0.01);
    // The pixel-only fallback is fooled by the white cap: the reason A2 uses `placed`.
    assert.equal(byId(await checkMain(png, cutout), "A2").ok, false);
  });
});

describe("checkMain negative controls", () => {
  it("an un-cut opaque photo fails A4 (real transparency)", async () => {
    const photo = await rgba(600, 600, [{ x: 0, y: 0, w: 600, h: 600, rgb: [180, 170, 160] }]);
    const { png, cutout } = await composeMain(photo);
    const checks = await checkMain(png, cutout);
    assert.equal(byId(checks, "A4").ok, false);
    assert.equal(mainOk(checks), false);
  });

  it("two separated blobs warn A5 but still compose", async () => {
    const two = await rgba(1000, 600, [
      { x: 50, y: 50, w: 300, h: 500, rgb: [10, 10, 10] },
      { x: 650, y: 50, w: 300, h: 500, rgb: [10, 10, 10] },
    ]);
    const stats = await analyzeCutout(two);
    assert.equal(stats.components, 2);
    const { png, cutout } = await composeMain(two);
    const checks = await checkMain(png, cutout);
    assert.equal(byId(checks, "A5").ok, false);
    assert.ok(mainOk(checks), "A5 is a warning");
  });

  it("a near-white product warns A7; a tiny source fails A6", async () => {
    const pale = await rgba(300, 300, [{ x: 50, y: 50, w: 100, h: 200, rgb: [250, 250, 250] }]);
    const { png, cutout } = await composeMain(pale);
    const checks = await checkMain(png, cutout);
    assert.equal(byId(checks, "A7").ok, false);
    assert.equal(byId(checks, "A6").ok, false);
  });

  it("rejects an empty alpha channel", async () => {
    await assert.rejects(composeMain(await rgba(50, 50, [])), /empty alpha/);
  });
});

/** A 2000×2000 RGB white canvas with an opaque block at (left, top). */
async function canvasWith(left: number, top: number, w: number, h: number): Promise<Uint8Array> {
  const block = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 120 } } })
    .png()
    .toBuffer();
  return new Uint8Array(
    await sharp({ create: { width: 2000, height: 2000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: block, left, top }])
      .png()
      .toBuffer(),
  );
}

describe("C3: centred, not cropped (measured from the written pixels)", () => {
  it("a correctly composed hero image passes, with a margin of at least 150 px", async () => {
    const { png, cutout, placed } = await composeMain(await product());
    const c3 = byId(await checkMain(png, cutout, placed), "C3");
    assert.equal(c3.ok, true);
    assert.ok((c3.value as number) >= 150, `margin ${c3.value}`);
    assert.equal(byId(await checkMain(png, cutout), "C3").ok, true, "the pixel fallback agrees");
  });

  it("fails a composite whose pixels do not match the claimed centred placement", async () => {
    const { cutout, placed } = await composeMain(await product());
    // Same claimed placement, but the product was drawn at the left edge.
    const misplaced = await canvasWith(0, placed.y, placed.width, placed.height);
    const checks = await checkMain(misplaced, cutout, placed);
    assert.equal(byId(checks, "C3").ok, false);
    assert.equal(mainOk(checks), false, "C3 is error-level and blocks the run");
    // A2 alone (placed box) would still pass: C3 is what catches it.
    assert.equal(byId(checks, "A2").ok, true);
  });

  it("fails a product that touches or crosses the canvas edge", async () => {
    const { cutout } = await composeMain(await product());
    const clipped = await canvasWith(1300, 300, 700, 1400); // touches the right edge
    assert.equal(byId(await checkMain(clipped, cutout), "C3").ok, false);
    const overflowing = { x: -20, y: 150, width: 1700, height: 1700 };
    assert.equal(byId(await checkMain(clipped, cutout, overflowing), "C3").ok, false);
  });
});

