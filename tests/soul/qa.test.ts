/** Identity photo QA (docs/spec/identity.md §4, §5.1) on synthetic photos with a fake detector. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { checkPhoto, checkPhotos, cropFor, hamming, isCandidate, laplacianVariance, phash, poseOf, sniffImage } from "../../lib/identity/qa.ts";
import { faceAt, fakeDetector, noisePhoto, oneFace } from "./helpers.ts";

describe("Q1 type sniffing", () => {
  it("accepts JPEG, PNG and WebP by magic bytes, and nothing else", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer());
    const webp = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer());
    assert.equal(sniffImage(await noisePhoto(8, 8)), "image/jpeg");
    assert.equal(sniffImage(png), "image/png");
    assert.equal(sniffImage(webp), "image/webp");
    assert.equal(sniffImage(new TextEncoder().encode("GIF89a....")), null);
    assert.equal(sniffImage(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), null, "HEIC");
  });

  it("rejects a mislabelled or corrupt file as unsupported_type", async () => {
    const r = await checkPhoto(new TextEncoder().encode("not an image"), 0, { detect: oneFace });
    assert.equal(r.reason, "unsupported_type");
    const truncated = (await noisePhoto(1200, 1500)).slice(0, 200);
    assert.equal((await checkPhoto(truncated, 0, { detect: oneFace })).reason, "unsupported_type");
  });
});

describe("per-photo checks", () => {
  it("passes a sharp single-face photo and crops it 4:5 without metadata", async () => {
    const bytes = await noisePhoto(1200, 1500, { exif: true });
    assert.ok((await sharp(bytes).metadata()).exif, "fixture carries EXIF");
    const r = await checkPhoto(bytes, 3, { detect: oneFace });
    assert.ok(isCandidate(r), `expected a pass, got ${r.reason}`);
    assert.equal(r.index, 3);
    assert.ok(r.score > 0 && r.score <= 1);
    assert.ok(Math.abs(r.crop.height / r.crop.width - 1.25) < 0.01);
    const meta = await sharp(r.png).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.exif, undefined, "crop is re-encoded from raw pixels");
    assert.ok(Math.max(meta.width!, meta.height!) <= 1024);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.match(r.phash, /^[0-9a-f]{16}$/);
  });

  it("rejects too_small, no_face, multiple_faces, face_too_small and blurry", async () => {
    assert.equal((await checkPhoto(await noisePhoto(400, 600), 0, { detect: oneFace })).reason, "too_small");
    assert.equal((await checkPhoto(await noisePhoto(), 0, { detect: fakeDetector(() => []) })).reason, "no_face");
    const two = fakeDetector((w, h) => [faceAt(w, h, 0.1, 0.2, 0.3), faceAt(w, h, 0.55, 0.2, 0.28)]);
    assert.equal((await checkPhoto(await noisePhoto(), 0, { detect: two })).reason, "multiple_faces");
    const tiny = fakeDetector((w, h) => [faceAt(w, h, 0.4, 0.4, 0.08)]);
    assert.equal((await checkPhoto(await noisePhoto(), 0, { detect: tiny })).reason, "face_too_small");
    assert.equal((await checkPhoto(await noisePhoto(1200, 1500, { blur: 12 }), 0, { detect: oneFace })).reason, "blurry");
  });

  it("ignores small background faces but warns and keeps them out of the crop", async () => {
    const withBackground = fakeDetector((w, h) => [faceAt(w, h, 0.3, 0.25, 0.3), faceAt(w, h, 0.85, 0.1, 0.06, 0, 0.8)]);
    const r = await checkPhoto(await noisePhoto(), 0, { detect: withBackground });
    assert.ok(isCandidate(r));
    assert.ok(r.warnings.includes("background_faces"));
  });

  it("warns on low resolution and on missing eye landmarks", async () => {
    const noEyes = fakeDetector((w, h) => [{ ...faceAt(w, h), landmarks: [] }]);
    const r = await checkPhoto(await noisePhoto(800, 1000), 0, { detect: noEyes });
    assert.ok(isCandidate(r));
    assert.ok(r.warnings.includes("low_resolution"));
    assert.ok(r.warnings.includes("eyes_not_found"));
  });
});

describe("Q6 duplicates across a set", () => {
  it("rejects an exact duplicate as `duplicate` and keeps the other", async () => {
    const a = await noisePhoto();
    const results = await checkPhotos([a, a, await noisePhoto(1200, 1500, { seedShift: 20 })], { detect: oneFace });
    assert.equal(results.filter((r) => r.reason === "duplicate").length, 1);
    assert.equal(results.filter(isCandidate).length, 2);
  });

  it("only processes the first 20 photos", async () => {
    const photo = new TextEncoder().encode("x");
    const results = await checkPhotos(Array(23).fill(photo), { detect: oneFace });
    assert.equal(results.length, 20);
  });
});

describe("helpers", () => {
  it("Laplacian variance is 0 on a flat image and large on noise", () => {
    assert.equal(laplacianVariance(new Uint8Array(100).fill(120), 10, 10), 0);
    const noise = Uint8Array.from({ length: 400 }, (_, i) => (i * 7919) % 256);
    assert.ok(laplacianVariance(noise, 20, 20) > 1000);
  });

  it("pHash is stable for the same image and distant for different ones", async () => {
    const a = await noisePhoto(256, 256);
    const b = await noisePhoto(256, 256, { seedShift: -40 });
    assert.equal(await phash(a), await phash(a));
    assert.ok(hamming(await phash(a), await phash(b)) > 6);
    assert.equal(hamming("0000000000000000", "000000000000000f"), 4);
  });

  it("pose buckets follow the spec's yaw thresholds", () => {
    assert.equal(poseOf(0.05), "front");
    assert.equal(poseOf(-0.3), "three_quarter_left");
    assert.equal(poseOf(0.3), "three_quarter_right");
    assert.equal(poseOf(0.6), "profile");
    assert.equal(poseOf(null), "front");
  });

  it("crops 2.2× the face width, 4:5, face centre at 42%, clamped to the image", () => {
    const face = { x: 400, y: 300, width: 300, height: 360 };
    const crop = cropFor(face, 2000, 2000);
    assert.equal(crop.width, 660);
    assert.equal(crop.height, 825);
    assert.equal(crop.x, Math.round(550 - 330));
    assert.equal(crop.y, Math.round(480 - 0.42 * 825));
    const edge = cropFor({ x: 0, y: 0, width: 400, height: 480 }, 900, 1000);
    assert.ok(edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= 900 && edge.y + edge.height <= 1000);
    assert.ok(Math.abs(edge.height / edge.width - 1.25) < 0.01);
  });

  it("tightens the crop to keep a background face out", () => {
    const face = { x: 800, y: 600, width: 300, height: 360 };
    const background = { x: 1250, y: 600, width: 60, height: 70 };
    const crop = cropFor(face, 3000, 3000, [background]);
    assert.ok(crop.x + crop.width <= background.x, "background face outside the crop");
    assert.ok(crop.width < 2.2 * face.width, "tightened from 2.2·fw");
  });
});
