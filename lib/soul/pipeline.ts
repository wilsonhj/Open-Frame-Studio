/**
 * Identity preview pipeline (slice C; docs/spec/identity.md §2 step 8, §7.1).
 *
 * Photo QA, cropping and selection run in `POST /api/souls` without any Comfy
 * call, so original photos never leave the server (§8.1, §8.3). This pipeline
 * renders the optional preview sheet of a saved identity: one
 * `klein_edit_multiref` job with refs[0..3] as image 1–4. Its request names
 * the identity's crop assets (`{ assetId }`, from `ensureAssets`); raw
 * `{ upload }` photos are refused before anything is uploaded, and `plan`
 * refuses (400, before any job) assets that are not all crops of one saved,
 * consented identity.
 */
import { assertIdentityConsent } from "../identity/consent.ts";
import type { ComfyPipelineStep } from "../contracts/pipeline.ts";
import type { PipelineDefinition, ValidateResult } from "../pipeline/types.ts";
import type { IdentityRequest, IdentityResult } from "../types.ts";
import { IDENTITY_MAX_REFS } from "../types.ts";
import { findByAssetIds, IdentityInputError } from "./registry.ts";

export const PREVIEW_STEP = "preview";
const PREVIEW_TIMEOUT_MS = 180_000;
/** Klein ref slots (image_1..image_4). */
const SLOTS = 4;
const SIZE = { width: 1024, height: 1024 };

function fail(error: string, field: string): ValidateResult<IdentityRequest> {
  return { ok: false, error, field };
}

export function validateIdentity(raw: unknown): ValidateResult<IdentityRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("request must be a JSON object", "");
  const r = raw as Record<string, unknown>;
  try {
    assertIdentityConsent(r.consent);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "consent is required", "consent");
  }
  if (typeof r.name !== "string" || !r.name.trim()) return fail("name is required", "name");
  if (!Array.isArray(r.photos) || r.photos.length === 0) return fail("photos are required", "photos");
  if (r.photos.length > IDENTITY_MAX_REFS) return fail(`at most ${IDENTITY_MAX_REFS} reference crops`, "photos");
  for (const [i, p] of r.photos.entries()) {
    const ref = p as Record<string, unknown> | null;
    if (ref && typeof ref.upload === "string") {
      // Never upload originals to Comfy (§8.3): QA + crops happen in /api/souls.
      return fail("send photos to /api/souls; previews take a saved identity's crop assets", `photos[${i}]`);
    }
    if (!ref || typeof ref.assetId !== "string" || !ref.assetId) return fail("expected { assetId }", `photos[${i}]`);
  }
  if (r.preview === false) return fail("this pipeline only renders previews", "preview");
  return {
    ok: true,
    value: { name: r.name.trim().slice(0, 40), consent: true, photos: r.photos.map((p) => ({ assetId: (p as { assetId: string }).assetId })), preview: true },
  };
}

/** The preview prompt: plain-word refs for FLUX.2 ("images 1, 2 and 3"), plus the style card. */
export function previewPrompt(refCount: number, description = ""): string {
  const n = Math.max(1, Math.min(SLOTS, refCount));
  const list = n === 1 ? "image 1" : `images ${Array.from({ length: n - 1 }, (_, i) => i + 1).join(", ")} and ${n}`;
  const look = description.trim() ? ` ${description.trim()}.` : "";
  return (
    `A clean identity reference sheet of the same person as in ${list}: a front portrait and two three-quarter views, ` +
    `neutral expression, soft even studio light, plain light-grey background, sharp focus.${look} ` +
    `Keep the face, hair and features exactly as in the reference images.`
  );
}

const assetIdsOf = (request: IdentityRequest) => request.photos.map((p) => ("assetId" in p ? p.assetId : "")).filter(Boolean);

export const soulPipeline: PipelineDefinition<"identity"> = {
  kind: "identity",
  validate: validateIdentity,
  async plan(request, ctx) {
    const ids = assetIdsOf(request).slice(0, SLOTS);
    const soul = await findByAssetIds(ids);
    if (!soul) throw new IdentityInputError("photos", "photos must be crop assets of one saved identity");
    if (!soul.consentedAt) throw new IdentityInputError("consent", "that identity has no likeness-consent record");
    const inputs: ComfyPipelineStep["inputs"] = {
      prompt: previewPrompt(ids.length, soul.styleCard.description),
      seed: ctx.randomSeed(),
      ...SIZE,
    };
    ids.forEach((id, i) => (inputs[`image_${i + 1}`] = id));
    return [
      {
        id: PREVIEW_STEP,
        kind: "comfy",
        workflow: "klein_edit_multiref",
        dependsOn: [],
        inputs,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        status: "pending",
      },
    ];
  },
  handlers: {},
  async buildResult(run): Promise<IdentityResult> {
    const step = run.steps.find((s) => s.id === PREVIEW_STEP);
    const preview = step?.status === "succeeded" ? (step.outputs?.[0] ?? null) : null;
    const identity = await findByAssetIds(assetIdsOf(run.request).slice(0, SLOTS));
    if (!identity) throw new Error("The identity for this preview no longer exists.");
    return { identity, rejected: [], preview };
  },
};
