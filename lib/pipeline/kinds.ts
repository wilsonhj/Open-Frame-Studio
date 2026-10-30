/**
 * FROZEN at contracts-v1 (orchestrator-owned; see docs/OWNERS.md).
 * The pipeline registry: one PipelineDefinition per PipelineKind. Slice A's
 * runtime and routes look definitions up here; tool slices only edit their
 * own lib/<kind>/pipeline.ts.
 */
import { cardsPipeline } from "../cards/pipeline.ts";
import { motionPipeline } from "../motion/pipeline.ts";
import { photoshootPipeline } from "../photoshoot/pipeline.ts";
import { soulPipeline } from "../soul/pipeline.ts";
import type { PipelineKind } from "../types.ts";
import type { AnyPipelineDefinition, PipelineDefinition, PipelineRegistry } from "./types.ts";

export const PIPELINE_KINDS: readonly PipelineKind[] = ["soul", "photoshoot", "cards", "motion"];

export const PIPELINES: PipelineRegistry = {
  soul: soulPipeline,
  photoshoot: photoshootPipeline,
  cards: cardsPipeline,
  motion: motionPipeline,
};

export function isPipelineKind(value: string): value is PipelineKind {
  return (PIPELINE_KINDS as readonly string[]).includes(value);
}

export function getPipeline<K extends PipelineKind>(kind: K): PipelineDefinition<K>;
export function getPipeline(kind: string): AnyPipelineDefinition | undefined;
export function getPipeline(kind: string): AnyPipelineDefinition | undefined {
  return isPipelineKind(kind) ? (PIPELINES[kind] as AnyPipelineDefinition) : undefined;
}
