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
  const values: BindingValues = {};
  for (const [name, value] of Object.entries(parsed)) {
    values[name] = value instanceof File ? await toAsset(value) : value;
  }
  return values;
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
