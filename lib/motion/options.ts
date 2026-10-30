/**
 * Motion options and copy shared by the pipeline (server) and the Slate
 * (client). Pure: no registry or filesystem imports, so the client bundle can
 * use it.
 */
import { h3R2v } from "../bindings/h3_r2v.ts";
import type { OutputRef } from "../contracts/job.ts";
import type { MotionAspect, MotionRequest } from "../contracts/motion.ts";

/** Seconds offered in the Slate; the API accepts any length the model was trained on. */
export const MOTION_LENGTHS = [5, 8, 10] as const;
export const MIN_SECONDS = 5;
/** ~362 frames, the top of H3's trained range (docs/spikes/h3-r2v.md:60). */
export const MAX_SECONDS = 15;
export const DEFAULT_ASPECT: MotionAspect = "9:16";
/** Final renders: 20 base steps (PLAN "Update after Wave 0": 20–25 for hero clips). */
export const FINAL_STEPS = 20;
export const PREVIEW_STEPS = 4;

/** Shown on /motion and in the README; keep it strict (docs/PLAN.md, "Licences and claims"). */
export const H3_LICENCE_NOTICE =
  "MiniMax H3 is open weights under the MiniMax H3 Community License, a conditional licence, not a permissive one. " +
  "Clips generated on Comfy Cloud come with commercial rights under Comfy's terms. Self-hosting the weights is " +
  "not permitted in excluded territories, which include the United States, the European Union, the United Kingdom " +
  "and South Korea, and local commercial use needs a licence.";

/**
 * Identities as `<Picture 1>`. Off until the Identity registry (slice C)
 * implements `bestRefs`: `validate` is the only check that runs before the
 * runtime uploads the product photo, so while this is false an `identityId`
 * is refused there (400) rather than after a paid upload. Slice C flips it.
 */
export const MOTION_IDENTITIES_ENABLED = false;

/** Wall-clock on Comfy Cloud, 5 s at 480x864: Preview (turbo) ~17 s, Final (20 base steps) ~70 s submit to done. */
export const MOTION_TIME_HINT = "Preview ≈ 20 s · Final ≈ 1–2 min, plus any queue";
export const MOTION_CANCEL_HINT = "Cancel asks Comfy to stop the job and its billing; a job that already finished is billed.";

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;

/**
 * The clip among a step's outputs. Comfy Cloud labels the MP4 `type: "image"`,
 * so match the graph's video node first, then a video content type or file
 * extension, and only then the `type` label.
 */
export function pickClipVideo(outputs: readonly OutputRef[] | null | undefined): OutputRef | null {
  if (!outputs?.length) return null;
  const looksVideo = (o: OutputRef) => !!o.contentType?.startsWith("video/") || VIDEO_EXT.test(o.name ?? "");
  const fromNode = outputs.filter((o) => o.nodeId === h3R2v.outputs.video);
  return fromNode.find(looksVideo) ?? fromNode[0] ?? outputs.find(looksVideo) ?? outputs.find((o) => o.type === "video") ?? null;
}

export function stepsFor(quality: MotionRequest["quality"]): number {
  return quality === "preview" ? PREVIEW_STEPS : FINAL_STEPS;
}
