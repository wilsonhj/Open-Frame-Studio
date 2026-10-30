/**
 * Motion prompt builder (slice F; docs/spec/ux.md §8, docs/spec/api.md §2.4).
 *
 * Users write a short line with role tokens, `[Person]` and `[Product]`; the
 * builder maps them to H3's `<Picture 1>` / `<Picture 2>` tags and always adds
 * a role sentence, because H3 needs every reference named with its role
 * (docs/spikes/h3-r2v.md:69). Raw `<Picture N>` tags typed by a user are
 * removed: the graph has exactly two references, and users never type the tags.
 * Pure, no I/O: shared by the pipeline (server) and the Slate (client).
 */

export const PERSON_TOKEN = "[Person]";
export const PRODUCT_TOKEN = "[Product]";
export const MAX_MOTION_PROMPT = 600;

const ROLE_LINE =
  "<Picture 1> is the person: keep their face, hair and clothing exactly. " +
  "<Picture 2> is the product: keep its shape, colours and label exactly as shown.";

/** `[Person]` / `[Product]` (any case, optional inner spaces) → `<Picture 1>` / `<Picture 2>`. */
export function buildMotionPrompt(text: string): string {
  const body = text
    .replace(/<\s*picture\s*\d+\s*>/gi, "")
    .replace(/\[\s*person\s*\]/gi, "<Picture 1>")
    .replace(/\[\s*product\s*\]/gi, "<Picture 2>")
    .replace(/\s+/g, " ")
    .trim();
  return body ? `${ROLE_LINE} ${body}` : ROLE_LINE;
}

/**
 * Frame count H3 renders for `seconds`: the graph's own expression (node 131,
 * workflows/h3_r2v.api.json) rounds to 24 fps, then up onto the 17k+5 grid.
 * 5 s → 124 frames.
 */
export function framesFor(seconds: number): number {
  const n = Math.max(5, Math.round(seconds * 24));
  return n + (((5 - (n % 17)) % 17) + 17) % 17;
}
