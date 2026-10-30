/**
 * Identity intake on the server (docs/spec/identity.md §2 steps 2–6, §3.3):
 * consent first, then QA and selection, then save. Originals are processed in
 * memory only and dropped when this returns (§8.1); nothing here calls Comfy.
 */
import "server-only";

import { createIdentity, IdentityInputError } from "../soul/registry.ts";
import type { Identity, PhotoQaReason, StyleCard } from "../types.ts";
import { assertIdentityConsent } from "./consent.ts";
import { checkPhotos, isCandidate, MAX_PHOTOS, type QaOptions, type QaWarning } from "./qa.ts";
import { selectRefs } from "./select.ts";

export type PhotoReport = { index: number; reason: PhotoQaReason | null; warnings: QaWarning[]; score: number; chosen: boolean };

export type IntakeResult =
  | { ok: true; identity: Identity; photos: PhotoReport[]; advisories: string[] }
  | { ok: false; error: string; photos: PhotoReport[]; advisories: string[] };

export type IntakeInput = { name: unknown; consent: unknown; photos: Uint8Array[]; styleCard?: Partial<StyleCard>; pinned?: number[] };

export async function intakeIdentity(input: IntakeInput, options: QaOptions = {}): Promise<IntakeResult> {
  // Consent before a single photo is decoded.
  assertIdentityConsent(input.consent);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new IdentityInputError("name", "Give the identity a name.");
  if (input.photos.length === 0) throw new IdentityInputError("photos", "Add photos.");
  const advisories: string[] = [];
  if (input.photos.length > MAX_PHOTOS) advisories.push(`Only the first ${MAX_PHOTOS} photos were checked.`);

  const results = await checkPhotos(input.photos, options);
  const candidates = results.filter(isCandidate);
  const selection = selectRefs(candidates, input.pinned ?? []);
  advisories.push(...selection.advisories);
  const chosen = new Set(selection.chosen.map((c) => c.index));
  const photos: PhotoReport[] = results.map((r) => ({
    index: r.index,
    reason: r.reason,
    warnings: r.warnings,
    score: Math.round(r.score * 1000) / 1000,
    chosen: chosen.has(r.index),
  }));
  if (selection.tooFew) return { ok: false, error: "Need at least 3 usable photos.", photos, advisories };
  const identity = await createIdentity({ name, consent: input.consent, refs: selection.chosen, styleCard: input.styleCard });
  return { ok: true, identity, photos, advisories };
}
