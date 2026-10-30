/**
 * Pure helpers for the Photoshoot studio: restore the slate (mode, count,
 * notes) from a recovered run, and summarise a run's progress. No I/O.
 */
import { MODE_TEMPLATES, isDemoMode, type DemoMode } from "../enhancer/modes.ts";
import type { PipelineRun } from "../contracts/pipeline.ts";
import { TERMINAL_STEP_STATUSES } from "../contracts/pipeline.ts";
import type { PhotoshootRequest } from "../contracts/photoshoot.ts";

export type Slate = { mode: DemoMode; count: number; notes: string };

/**
 * The slate a run was shot with. The count is snapped into the mode's range
 * (the plan clamps it the same way); an unknown mode falls back to `fallback`.
 * The product photo can't be restored: the run holds only its asset id.
 */
export function slateFromRequest(request: Pick<PhotoshootRequest, "mode" | "count" | "prompt">, fallback: DemoMode): Slate {
  const mode = isDemoMode(request.mode) ? request.mode : fallback;
  const { min, max, def } = MODE_TEMPLATES[mode].count;
  const asked = Number.isInteger(request.count) ? request.count : def;
  return { mode, count: Math.min(max, Math.max(min, asked)), notes: typeof request.prompt === "string" ? request.prompt : "" };
}

/**
 * Overall progress. `done` counts steps that reached a terminal status (every
 * photoshoot step is one Comfy job). `fraction` is `run.progress`, which also
 * includes Comfy's progress of running steps (lib/pipeline/runner.ts), so it
 * drives the bar width but can't be turned into a count of finished jobs.
 */
export function runProgress(run: Pick<PipelineRun, "progress" | "steps">): { done: number; total: number; fraction: number } {
  const total = run.steps.length;
  const fraction = Number.isFinite(run.progress) ? Math.min(1, Math.max(0, run.progress)) : 0;
  const done = run.steps.filter((s) => TERMINAL_STEP_STATUSES.includes(s.status)).length;
  return { done, total, fraction };
}
