/**
 * STUB (W2.0 skeleton). Owner: slice C (docs/OWNERS.md). The Soul registry
 * (`${DATA_DIR:-.data}/souls/<id>/`, docs/spec/api.md §2.0, docs/spec/soul.md).
 * Imported read-only by Photoshoot (D) and Motion (F): keep these exports and
 * signatures; implement the bodies. Server-only (filesystem + Comfy uploads).
 */
import type { Soul, SoulRef } from "../types.ts";

/** A ref whose image is a Comfy asset (usable as a graph image input). */
export type AssetSoulRef = Extract<SoulRef, { assetId: string }>;

/** Thrown by `bestRefs` / `getSoulOrThrow` callers for an unknown id (routes map it to 404). */
export class SoulNotFoundError extends Error {
  readonly soulId: string;
  constructor(soulId: string) {
    super(`Soul ${soulId} not found.`);
    this.name = "SoulNotFoundError";
    this.soulId = soulId;
  }
}

const NOT_IMPLEMENTED = "not implemented: soul registry (slice C)";

/** Every saved Soul, newest first. */
export async function listSouls(): Promise<Soul[]> {
  throw new Error(NOT_IMPLEMENTED);
}

/** One Soul by id, or `null` if absent. */
export async function getSoul(id: string): Promise<Soul | null> {
  void id;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The Soul's best `n` refs (best first, `1 <= n <= SOUL_MAX_REFS`, fewer if the
 * Soul has fewer), each with a live `assetId` (`ensureAssets` applied).
 * Throws SoulNotFoundError for an unknown id.
 */
export async function bestRefs(soulId: string, n: number): Promise<AssetSoulRef[]> {
  void soulId;
  void n;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Make every ref a Comfy asset: upload refs that only have a `path` (an
 * imported bundle) or whose asset is gone, persist the new ids, and return the
 * updated Soul. Idempotent (content-addressed by `sha256`).
 */
export async function ensureAssets(soul: Soul): Promise<Soul & { refs: AssetSoulRef[] }> {
  void soul;
  throw new Error(NOT_IMPLEMENTED);
}
