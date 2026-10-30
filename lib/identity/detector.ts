/**
 * Server-side face detector: OpenCV YuNet (2023mar, MIT) on onnxruntime-node
 * (MIT), docs/spec/identity.md §4.2 tier B. CPU only, no network: the model
 * ships in lib/identity/models/ (LICENSE and NOTICE beside it).
 *
 * The ONNX graph has a fixed 640×640 BGR input and 12 raw heads (cls, obj,
 * bbox, kps at strides 8/16/32). Without OpenCV we decode the priors and run
 * NMS ourselves, following OpenCV's FaceDetectorYN. Images are letterboxed
 * (scaled to fit, padded right/bottom), so coordinates map back with one scale.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

export const YUNET_FILE = "face_detection_yunet_2023mar.onnx";
export const YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const INPUT = 640;
const STRIDES = [8, 16, 32] as const;
/** Detections below this are dropped before NMS (spec §4.1 Q7: score ≥ 0.5). */
export const SCORE_THRESHOLD = 0.5;
const NMS_IOU = 0.3;
const TOP_K = 50;

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
/**
 * One face in source pixels. Landmarks in YuNet order: right eye, left eye,
 * nose tip, right mouth corner, left mouth corner ("right" = the subject's).
 */
export type Face = { box: Box; score: number; landmarks: Point[] };

/** What QA needs from a detector: faces in an RGB raster (3 bytes per pixel). */
export type FaceDetector = (rgb: Uint8Array, width: number, height: number) => Promise<Face[]>;

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | ArrayLike<number> }>>;
};

/** The detector can't run here (model file missing or altered, runtime not loadable): routes answer 503. */
export class FaceModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceModelUnavailableError";
  }
}

/** Throws unless `bytes` are the pinned model (a truncated or swapped file never loads). */
export function checkModel(bytes: Uint8Array): Uint8Array {
  if (createHash("sha256").update(bytes).digest("hex") !== YUNET_SHA256) {
    throw new FaceModelUnavailableError(`Face detector model ${YUNET_FILE} does not match its checksum.`);
  }
  return bytes;
}

async function readModel(): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    // A static path, so the build traces just this file.
    bytes = await readFile(modelPath());
  } catch {
    throw new FaceModelUnavailableError(`Face detector model ${YUNET_FILE} is missing from this deployment.`);
  }
  return checkModel(bytes);
}

let session: Promise<{ session: Session; Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown }> | null = null;

function modelPath(): string {
  return join(process.cwd(), "lib/identity/models", YUNET_FILE);
}

function load() {
  session ??= (async () => {
    const bytes = await readModel();
    let ort: typeof import("onnxruntime-node");
    try {
      ort = await import("onnxruntime-node");
    } catch {
      throw new FaceModelUnavailableError("The face detector runtime (onnxruntime-node) could not be loaded.");
    }
    const created = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: "all" });
    return { session: created as unknown as Session, Tensor: ort.Tensor as never };
  })();
  session.catch(() => (session = null));
  return session;
}

/** Letterbox an RGB raster into the model's 640×640 BGR float input. */
async function toInput(rgb: Uint8Array, width: number, height: number): Promise<{ input: Float32Array; scale: number }> {
  const scale = Math.min(INPUT / width, INPUT / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer();
  const plane = INPUT * INPUT;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 3;
      const dst = y * INPUT + x;
      input[dst] = resized[src + 2]; // B
      input[plane + dst] = resized[src + 1]; // G
      input[2 * plane + dst] = resized[src]; // R
    }
  }
  return { input, scale };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Decode the raw heads into scored faces in model pixels (before NMS). */
export function decode(outputs: Record<string, ArrayLike<number>>, threshold = SCORE_THRESHOLD): Face[] {
  const faces: Face[] = [];
  for (const stride of STRIDES) {
    const cols = INPUT / stride;
    const rows = INPUT / stride;
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < threshold) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks: Point[] = [];
        for (let n = 0; n < 5; n++) {
          landmarks.push({ x: (kps[i * 10 + 2 * n] + c) * stride, y: (kps[i * 10 + 2 * n + 1] + r) * stride });
        }
        faces.push({ box: { x: cx - w / 2, y: cy - h / 2, width: w, height: h }, score, landmarks });
      }
    }
  }
  return faces;
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy NMS, best score first. */
export function nms(faces: Face[], threshold = NMS_IOU, topK = TOP_K): Face[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: Face[] = [];
  for (const face of sorted) {
    if (kept.length >= topK) break;
    if (kept.every((k) => iou(k.box, face.box) <= threshold)) kept.push(face);
  }
  return kept;
}

/** Map a model-space face back to source pixels and clip it to the image. */
function toSource(face: Face, scale: number, width: number, height: number): Face {
  const s = 1 / scale;
  const x = Math.max(0, face.box.x * s);
  const y = Math.max(0, face.box.y * s);
  return {
    score: face.score,
    box: {
      x,
      y,
      width: Math.min(width, (face.box.x + face.box.width) * s) - x,
      height: Math.min(height, (face.box.y + face.box.height) * s) - y,
    },
    landmarks: face.landmarks.map((p) => ({ x: p.x * s, y: p.y * s })),
  };
}

/** YuNet on an RGB raster: faces with score ≥ SCORE_THRESHOLD, best first. */
export const detectFaces: FaceDetector = async (rgb, width, height) => {
  const { session: s, Tensor } = await load();
  const { input, scale } = await toInput(rgb, width, height);
  const result = await s.run({ input: new Tensor("float32", input, [1, 3, INPUT, INPUT]) });
  const outputs: Record<string, ArrayLike<number>> = {};
  for (const [name, tensor] of Object.entries(result)) outputs[name] = tensor.data;
  return nms(decode(outputs))
    .map((f) => toSource(f, scale, width, height))
    .filter((f) => f.box.width > 0 && f.box.height > 0);
};
