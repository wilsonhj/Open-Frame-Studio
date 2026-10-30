/** YuNet decode + NMS, and the vendored model itself (docs/spec/identity.md §4.2). */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import sharp from "sharp";

import { checkModel, decode, detectFaces, FaceModelUnavailableError, nms, YUNET_FILE, YUNET_SHA256 } from "../../lib/identity/detector.ts";

function heads(hits: { stride: 8 | 16 | 32; r: number; c: number; score: number; dx?: number; dy?: number; logW?: number }[]) {
  const out: Record<string, Float32Array> = {};
  for (const s of [8, 16, 32]) {
    const cells = (640 / s) ** 2;
    out[`cls_${s}`] = new Float32Array(cells);
    out[`obj_${s}`] = new Float32Array(cells);
    out[`bbox_${s}`] = new Float32Array(cells * 4);
    out[`kps_${s}`] = new Float32Array(cells * 10);
  }
  for (const h of hits) {
    const i = h.r * (640 / h.stride) + h.c;
    out[`cls_${h.stride}`][i] = h.score;
    out[`obj_${h.stride}`][i] = h.score;
    out[`bbox_${h.stride}`].set([h.dx ?? 0.5, h.dy ?? 0.5, h.logW ?? Math.log(4), h.logW ?? Math.log(4)], i * 4);
  }
  return out;
}

describe("YuNet decode", () => {
  it("decodes a prior into a box in model pixels with score sqrt(cls·obj)", () => {
    const faces = decode(heads([{ stride: 16, r: 10, c: 20, score: 0.9 }]));
    assert.equal(faces.length, 1);
    const f = faces[0];
    assert.ok(Math.abs(f.score - 0.9) < 1e-6);
    // centre (20.5·16, 10.5·16) = (328, 168); size 4·16 = 64
    assert.ok(Math.abs(f.box.x - (328 - 32)) < 1e-3 && Math.abs(f.box.y - (168 - 32)) < 1e-3);
    assert.ok(Math.abs(f.box.width - 64) < 1e-3);
    assert.equal(f.landmarks.length, 5);
  });

  it("drops low scores and suppresses overlapping boxes", () => {
    const faces = decode(heads([
      { stride: 16, r: 10, c: 20, score: 0.9 },
      { stride: 16, r: 10, c: 21, score: 0.8, dx: 0.1 },
      { stride: 16, r: 30, c: 5, score: 0.7 },
      { stride: 8, r: 2, c: 2, score: 0.3 },
    ]));
    assert.equal(faces.length, 3);
    const kept = nms(faces);
    assert.equal(kept.length, 2);
    assert.ok(Math.abs(kept[0].score - 0.9) < 1e-6);
  });
});

describe("vendored YuNet model", () => {
  it("is the pinned 2023mar file", async () => {
    const bytes = await readFile(`lib/identity/models/${YUNET_FILE}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), YUNET_SHA256);
  });

  it("refuses an altered model file at load (routes answer 503)", async () => {
    const bytes = new Uint8Array(await readFile(`lib/identity/models/${YUNET_FILE}`));
    assert.equal(checkModel(bytes), bytes);
    bytes[bytes.length - 1] ^= 0xff;
    assert.throws(() => checkModel(bytes), (e: unknown) => e instanceof FaceModelUnavailableError && /checksum/.test(e.message));
  });

  it("loads on CPU and finds no face in a product photo", async () => {
    const { data, info } = await sharp("fixtures/products/product-mug-tiles.png").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const faces = await detectFaces(new Uint8Array(data), info.width, info.height);
    assert.deepEqual(faces, []);
  });
});
