/**
 * Parse multipart form fields into GraphBinding values (`BindingValues`).
 * Validates each field per its GraphValueKind (and `required` / `min` / `max`
 * / `choices`) and turns image parts into asset handles via `toAsset`. It
 * never touches a graph: apply the result with `applyBindings`.
 */
import type { BindingValues } from "./bindings/apply.ts";
import type { AssetHandle, GraphBinding, GraphInputBinding, GraphValue } from "./types.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const DEFAULT_MAX_TEXT = 2_000;

export class InputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "InputError";
    this.field = field;
  }
}

/** Minimal FormData surface (works with the web FormData). */
export type FormLike = { get(name: string): FormDataEntryValue | null };

/** Turns an uploaded file into an asset handle (e.g. `client.assets.fromBytes`). */
export type ToAsset = (file: File) => Promise<AssetHandle> | AssetHandle;

/**
 * Validate every bound field first (throws InputError), then convert image
 * parts with `toAsset`. Absent optional fields are left out, so the graph's
 * own widget values stay in effect.
 */
export async function parseInputs(binding: GraphBinding, form: FormLike, toAsset: ToAsset): Promise<BindingValues> {
  const parsed: Record<string, Exclude<GraphValue, AssetHandle> | File> = {};
  for (const [name, spec] of Object.entries(binding.inputs)) {
    const value = parseOne(name, spec, form.get(name));
    if (value !== undefined) parsed[name] = value;
  }
  await verifyImageBytes(parsed);
  const values: BindingValues = {};
  for (const [name, value] of Object.entries(parsed)) {
    values[name] = value instanceof File ? await toAsset(value) : value;
  }
  return values;
}

/** A uniformly random integer in [min, max] (both safe integers). */
function randomInt(min: number, max: number): number {
  const [high, low] = globalThis.crypto.getRandomValues(new Uint32Array(2));
  const unit = ((high & 0x1fffff) * 2 ** 32 + low) / 2 ** 53; // [0, 1)
  return min + Math.floor(unit * (max - min + 1));
}

/** The value each `randomize` input ran with, so the UI can show and lock it. */
export function seedsOf(binding: GraphBinding, values: BindingValues): Record<string, number> {
  const seeds: Record<string, number> = {};
  for (const [name, spec] of Object.entries(binding.inputs)) {
    const value = values[name];
    if (spec.randomize && typeof value === "number") seeds[name] = value;
  }
  return seeds;
}

const SIGNATURES: Record<(typeof IMAGE_TYPES)[number], { label: string; matches(head: Uint8Array): boolean }> = {
  "image/png": { label: "PNG", matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { label: "JPEG", matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  "image/webp": {
    label: "WebP",
    matches: (h) => startsWith(h, [0x52, 0x49, 0x46, 0x46]) && startsWith(h.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
};

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * The declared type of an upload is whatever the browser (or caller) says.
 * Check each image's leading bytes match it before it is uploaded to Comfy.
 */
export async function verifyImageBytes(values: Record<string, unknown>): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    if (!(value instanceof File)) continue;
    const signature = SIGNATURES[value.type as keyof typeof SIGNATURES];
    const head = new Uint8Array(await value.slice(0, 12).arrayBuffer());
    if (!signature?.matches(head)) {
      throw new InputError(name, `"${name}" is not a valid ${signature?.label ?? "image"} file.`);
    }
  }
}

function parseOne(
  name: string,
  spec: GraphInputBinding,
  raw: FormDataEntryValue | null,
): Exclude<GraphValue, AssetHandle> | File | undefined {
  const missing = raw === null || (typeof raw === "string" && raw.trim() === "");
  if (spec.kind === "image") {
    if (missing || !(raw instanceof File) || raw.size === 0) {
      if (spec.required) throw new InputError(name, `Upload an image for "${name}".`);
      return undefined;
    }
    if (!(IMAGE_TYPES as readonly string[]).includes(raw.type)) {
      throw new InputError(name, `"${name}" must be PNG, JPEG or WebP.`);
    }
    if (raw.size > MAX_IMAGE_BYTES) throw new InputError(name, `"${name}" must be under 20 MB.`);
    return raw;
  }
  if (raw instanceof File) throw new InputError(name, `"${name}" must be a text field.`);
  if (missing && spec.randomize && spec.kind === "int") {
    return randomInt(spec.min ?? 0, spec.max ?? Number.MAX_SAFE_INTEGER);
  }
  if (missing) {
    if (spec.required) throw new InputError(name, `"${name}" is required.`);
    return undefined;
  }
  const text = (raw as string).trim();
  switch (spec.kind) {
    case "text": {
      if (spec.choices) {
        if (!spec.choices.includes(text)) throw new InputError(name, `"${name}" is not a supported option.`);
        return text;
      }
      if (text.length > DEFAULT_MAX_TEXT) {
        throw new InputError(name, `"${name}" must be at most ${DEFAULT_MAX_TEXT} characters.`);
      }
      return text;
    }
    case "int":
    case "float": {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new InputError(name, `"${name}" must be a number.`);
      if (spec.kind === "int" && !Number.isSafeInteger(value)) {
        throw new InputError(name, `"${name}" must be a whole number.`);
      }
      if (spec.min !== undefined && value < spec.min) throw new InputError(name, `"${name}" must be ≥ ${spec.min}.`);
      if (spec.max !== undefined && value > spec.max) throw new InputError(name, `"${name}" must be ≤ ${spec.max}.`);
      return value;
    }
    case "bool":
      if (!["true", "false", "1", "0", "on", "off"].includes(text)) {
        throw new InputError(name, `"${name}" must be true or false.`);
      }
      return ["true", "1", "on"].includes(text);
    default: {
      const unknown: never = spec.kind;
      throw new InputError(name, `Unsupported input kind for "${name}": ${String(unknown)}.`);
    }
  }
}
