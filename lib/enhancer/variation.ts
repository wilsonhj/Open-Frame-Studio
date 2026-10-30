/**
 * Multi-output variation (docs/spec/photoshoot.md §6). Pure and deterministic:
 * the same (template, notes, n, seed) always yields the same prompts.
 *
 * Free-variation modes rotate preset, lighting, angle and palette with strides
 * co-prime to each pool size and offsets hashed from the seed (seed_i = seed + i).
 * Style-locked modes (`sharedStyle`) pin preset, lighting and palette and the
 * seed, and vary only the angle and the slide role.
 */
import type { ModeTemplate, VariationAxis, VariationPick } from "../contracts/photoshoot.ts";

export type BuiltPrompt = {
  index: number;
  prompt: string;
  seed: number;
  variation: VariationPick;
  /** Slide role for style-locked modes. */
  role?: string;
};

const AXES: readonly VariationAxis[] = ["preset", "lighting", "angle", "palette"];
const STRIDES = [1, 2, 3, 5, 7, 11, 13];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Smallest stride from STRIDES (starting at `start`) co-prime with `size`. */
function coprimeStride(size: number, start: number): number {
  for (let k = 0; k < STRIDES.length; k++) {
    const s = STRIDES[(start + k) % STRIDES.length];
    if (gcd(s, size) === 1) return s;
  }
  return 1;
}

/** FNV-1a over the seed and a salt, as an unsigned 32-bit int. */
function hash(seed: number, salt: string): number {
  let h = 0x811c9dc5;
  const text = `${seed >>> 0}:${salt}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pool(template: ModeTemplate, axis: VariationAxis): readonly string[] {
  const values = template.pools?.[axis];
  if (!values || values.length === 0) throw new Error(`mode ${template.mode} has no ${axis} pool`);
  return values;
}

function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => slots[key] ?? match);
}

const PRODUCT = "the product from image 1, unchanged: same shape, label, colour";

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildPrompts(template: ModeTemplate, notes: string, n: number, seed: number): BuiltPrompt[] {
  const count = Math.max(0, Math.floor(n));
  const base = seed >>> 0;
  const extra = notes.trim();
  const out: BuiltPrompt[] = [];

  if (template.sharedStyle) {
    const lock: VariationPick = { preset: "", lighting: "", angle: "", palette: "" };
    for (const axis of ["preset", "lighting", "palette"] as const) {
      const values = pool(template, axis);
      lock[axis] = values[hash(base, axis) % values.length];
    }
    const angles = pool(template, "angle");
    const roles = template.roles ?? [];
    const styleBlock = `Shared visual system for every slide: ${lock.preset}, ${lock.lighting}, ${lock.palette}, one colour grade.`;
    for (let i = 0; i < count; i++) {
      // Closing shot is always last; middle roles repeat for long sets.
      const role =
        roles.length === 0
          ? ""
          : i === count - 1 && count > 1
            ? roles[roles.length - 1]
            : roles[i % Math.max(1, roles.length - 1)];
      const variation: VariationPick = { ...lock, angle: angles[i % angles.length] };
      const body = fill(template.promptTemplate, {
        product: PRODUCT,
        style: lock.preset,
        lighting: cap(lock.lighting),
        angle: variation.angle,
        palette: lock.palette,
      });
      const prompt = [styleBlock, role ? `Composition: ${role}.` : "", body, extra ? `Notes: ${extra}.` : ""]
        .filter(Boolean)
        .join(" ");
      out.push({ index: i, prompt, seed: base, variation, role });
    }
    return out;
  }

  const rot = AXES.map((axis, k) => {
    const values = pool(template, axis);
    return {
      axis,
      values,
      stride: axis === "preset" ? 1 : coprimeStride(values.length, k),
      offset: axis === "preset" ? 0 : hash(base, axis) % values.length,
    };
  });
  for (let i = 0; i < count; i++) {
    const variation = {} as VariationPick;
    for (const r of rot) variation[r.axis] = r.values[(i * r.stride + r.offset) % r.values.length];
    const body = fill(template.promptTemplate, {
      product: PRODUCT,
      style: variation.preset,
      lighting: cap(variation.lighting),
      angle: variation.angle,
      palette: variation.palette,
    });
    const prompt = extra ? `${body} Notes: ${extra}.` : body;
    out.push({ index: i, prompt, seed: (base + i) >>> 0, variation });
  }
  return out;
}
