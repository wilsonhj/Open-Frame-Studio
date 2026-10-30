/**
 * Tile state from the persisted steps (docs/spec/listing.md §8). Pure and
 * dependency-free, so the pipeline's buildResult and the board share it.
 */
import type { CardAssetId, CardTile, PipelineRun, PipelineStep } from "../types.ts";
import { TERMINAL_STEP_STATUSES } from "../types.ts";

type RenderData = { seed?: number | null; missing?: string[] };

/** The steps that feed an asset's render step (cutouts, diffusion, upscale). */
export function feeders(run: Readonly<Pick<PipelineRun<"listing">, "steps">>, asset: CardAssetId): PipelineStep[] {
  return run.steps.filter((s) => s.id !== asset && s.id.startsWith(`${asset}_`));
}

/**
 * Why a regenerate (a new seed, R-A3) can't change this tile, or null when it
 * can. A card that failed on copy length fails again (the copy is part of the
 * run). A card with no seeded diffusion step (cutouts only, or code only)
 * redraws the same pixels, so it can only be retried after a step failed.
 */
export function regenerateBlocker(run: Readonly<Pick<PipelineRun<"listing">, "steps">>, asset: CardAssetId): string | null {
  const render = run.steps.find((s) => s.id === asset);
  if (!render) return `no tile ${asset}`;
  if (render.error?.code === "text_too_long") return "the copy is too long for this card; shorten it and start a new run";
  const feeds = feeders(run, asset);
  if (feeds.some((s) => typeof s.inputs.seed === "number")) return null;
  const failed = (s: PipelineStep) => s.status !== "succeeded" && s.status !== "needs_input" && TERMINAL_STEP_STATUSES.includes(s.status);
  if ([render, ...feeds].some(failed)) return null;
  return "this card has no generated image, so a new seed would draw the same card";
}

export function tileFor(run: Readonly<Pick<PipelineRun<"listing">, "steps">>, asset: CardAssetId): CardTile {
  const render = run.steps.find((s) => s.id === asset);
  if (!render) return { asset, state: "skipped", seed: null, url: null, missing: [], error: null };
  const data = (render.data ?? {}) as RenderData;
  const feeds = feeders(run, asset);
  const firstGen = feeds.find((s) => typeof s.inputs.seed === "number");
  const seed = typeof firstGen?.inputs.seed === "number" ? firstGen.inputs.seed : (data.seed ?? null);
  let state = render.status;
  let error = render.error ?? null;
  // Before the card is drawn, the tile shows its upstream state: the first
  // feeder that failed, else the state of one still in flight.
  if (render.status === "pending" || render.status === "skipped") {
    const bad = feeds.find((s) => s.status !== "succeeded" && s.status !== "pending" && TERMINAL_STEP_STATUSES.includes(s.status));
    const live = feeds.find((s) => !TERMINAL_STEP_STATUSES.includes(s.status) && s.status !== "pending");
    if (bad) {
      state = bad.status;
      error = bad.error ?? null;
    } else if (live) {
      state = live.status;
    }
  }
  return { asset, state, seed, url: render.outputs?.[0]?.url ?? null, missing: data.missing ?? [], error };
}
