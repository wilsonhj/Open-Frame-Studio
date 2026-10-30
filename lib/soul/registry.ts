/**
 * STUB (W2.0 skeleton). Owner: slice C (docs/OWNERS.md). The Identity registry
 * (`${DATA_DIR:-.data}/souls/<id>/`, docs/spec/api.md §2.0, docs/spec/identity.md).
 * Imported read-only by Photoshoot (D) and Motion (F): keep these exports and
 * signatures; implement the bodies. Server-only (filesystem + Comfy uploads).
 */
import type { Identity, IdentityRef } from "../types.ts";

/** A ref whose image is a Comfy asset (usable as a graph image input). */
export type AssetSoulRef = Extract<IdentityRef, { assetId: string }>;

/** Thrown by `bestRefs` / `getSoulOrThrow` callers for an unknown id (routes map it to 404). */
export class SoulNotFoundError extends Error {
  readonly identityId: string;
  constructor(identityId: string) {
    super(`Identity ${identityId} not found.`);
    this.name = "SoulNotFoundError";
    this.identityId = identityId;
  }
}

const NOT_IMPLEMENTED = "not implemented: soul registry (slice C)";

/** Every saved Identity, newest first. */
export async function listSouls(): Promise<Identity[]> {
  throw new Error(NOT_IMPLEMENTED);
}

/** One Identity by id, or `null` if absent. */
export async function getSoul(id: string): Promise<Identity | null> {
  void id;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The identity's best `n` refs (best first, `1 <= n <= SOUL_MAX_REFS`, fewer if the
 * Identity has fewer), each with a live `assetId` (`ensureAssets` applied).
 * Throws SoulNotFoundError for an unknown id.
 */
export async function bestRefs(identityId: string, n: number): Promise<AssetSoulRef[]> {
  void identityId;
  void n;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Make every ref a Comfy asset: upload refs that only have a `path` (an
 * imported bundle) or whose asset is gone, persist the new ids, and return the
 * updated Identity. Idempotent (content-addressed by `sha256`).
 */
export async function ensureAssets(soul: Identity): Promise<Identity & { refs: AssetSoulRef[] }> {
  void soul;
  throw new Error(NOT_IMPLEMENTED);
}
