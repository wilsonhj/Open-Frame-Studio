/**
 * Synthetic test inputs for identity QA. No real faces anywhere: photos are
 * generated noise, and a fake detector reports where "the face" is.
 */
import sharp from "sharp";

import type { Face, FaceDetector } from "../../lib/identity/detector.ts";

/** A noisy (sharp, textured) JPEG of the given size, with an optional EXIF block. */
export async function noisePhoto(width = 1200, height = 1500, options: { blur?: number; exif?: boolean; seedShift?: number } = {}): Promise<Uint8Array> {
  let img = sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128 + (options.seedShift ?? 0), sigma: 60 } } });
  if (options.blur) img = sharp(await img.png().toBuffer()).blur(options.blur);
  if (options.exif) img = img.withExif({ IFD0: { Artist: "test-artist", ImageDescription: "secret-location" } });
  const buf = await img.jpeg({ quality: 92 }).toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** A face box at the given fraction of the image, with eyes, nose and mouth landmarks. */
export function faceAt(width: number, height: number, fx = 0.35, fy = 0.25, fw = 0.3, yaw = 0, score = 0.95): Face {
  const box = { x: fx * width, y: fy * height, width: fw * width, height: fw * width * 1.2 };
  const eyeY = box.y + box.height * 0.4;
  const eyeL = { x: box.x + box.width * 0.3, y: eyeY };
  const eyeR = { x: box.x + box.width * 0.7, y: eyeY };
  const dist = eyeR.x - eyeL.x;
  const nose = { x: (eyeL.x + eyeR.x) / 2 + yaw * dist, y: box.y + box.height * 0.6 };
  return {
    box,
    score,
    landmarks: [eyeL, eyeR, nose, { x: eyeL.x, y: box.y + box.height * 0.8 }, { x: eyeR.x, y: box.y + box.height * 0.8 }],
  };
}

/** A detector that returns faces computed from the image size. */
export function fakeDetector(make: (width: number, height: number) => Face[]): FaceDetector {
  return async (_rgb, width, height) => make(width, height);
}

export const oneFace = fakeDetector((w, h) => [faceAt(w, h)]);
