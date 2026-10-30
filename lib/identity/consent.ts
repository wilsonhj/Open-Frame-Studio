/**
 * Likeness consent for identity intake (docs/spec/identity.md §2, §8.7).
 *
 * The brief forbids unlicensed likenesses, so an identity is only built from
 * photos the uploader confirms they may use. The UI asks before any photo is
 * picked, and the identity pipeline route must call `assertIdentityConsent`
 * before it uploads anything. No runtime dependencies: safe on client and server.
 */
import { InputError } from "../inputs.ts";

/** Field name in the identity request (JSON body or multipart form). */
export const IDENTITY_CONSENT_FIELD = "consent";

/** The statement the user ticks. Keep the UI and the API error in step with it. */
export const IDENTITY_CONSENT_TEXT = "These are photos of me, or I have this person's permission.";

/**
 * Throws InputError("consent") unless the request carries explicit consent:
 * JSON `true`, or a form checkbox value ("true" / "on"). Anything else,
 * including absence, is refused before a single photo is uploaded.
 */
export function assertIdentityConsent(value: unknown): asserts value is true | "true" | "on" {
  if (value === true || value === "true" || value === "on") return;
  throw new InputError(IDENTITY_CONSENT_FIELD, `Confirm consent first: "${IDENTITY_CONSENT_TEXT}"`);
}
