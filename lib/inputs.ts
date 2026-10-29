/**
 * Validate multipart form fields against a WorkflowBinding and apply them to
 * a workflow. Pure apart from the asset factory, so it is unit-testable.
 */
import type { InputBinding, WorkflowBinding } from "./types.ts";

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

export type ResolvedValue = string | number | boolean | File;
export type ResolvedInputs = Record<string, ResolvedValue>;

/** Minimal FormData surface (works with the web FormData). */
export type FormLike = { get(name: string): FormDataEntryValue | null };

export function resolveInputs(binding: WorkflowBinding, form: FormLike): ResolvedInputs {
  const values: ResolvedInputs = {};
  for (const [name, spec] of Object.entries(binding.inputs)) {
    const raw = form.get(name);
    const value = resolveOne(name, spec, raw);
    if (value !== undefined) values[name] = value;
  }
  return values;
}

function resolveOne(name: string, spec: InputBinding, raw: FormDataEntryValue | null): ResolvedValue | undefined {
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
    if (spec.default !== undefined) return spec.default;
    if (spec.required) throw new InputError(name, `"${name}" is required.`);
    return undefined;
  }
  const text = (raw as string).trim();
  switch (spec.kind) {
    case "text": {
      const max = spec.maxLength ?? DEFAULT_MAX_TEXT;
      if (text.length > max) throw new InputError(name, `"${name}" must be at most ${max} characters.`);
      return text;
    }
    case "number":
    case "integer": {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new InputError(name, `"${name}" must be a number.`);
      if (spec.kind === "integer" && !Number.isInteger(value)) {
        throw new InputError(name, `"${name}" must be a whole number.`);
      }
      if (spec.min !== undefined && value < spec.min) throw new InputError(name, `"${name}" must be ≥ ${spec.min}.`);
      if (spec.max !== undefined && value > spec.max) throw new InputError(name, `"${name}" must be ≤ ${spec.max}.`);
      return value;
    }
    case "boolean":
      if (!["true", "false", "1", "0", "on", "off"].includes(text)) {
        throw new InputError(name, `"${name}" must be true or false.`);
      }
      return ["true", "1", "on"].includes(text);
    case "choice":
      if (!spec.choices?.includes(text)) throw new InputError(name, `"${name}" is not a supported option.`);
      return text;
    default:
      throw new InputError(name, `Unsupported input kind for "${name}".`);
  }
}

/** Anything with `setInput(node, field, value)` (an SDK Workflow). */
export type InputTarget = { setInput(nodeId: string, field: string, value: unknown): void };

/**
 * Apply resolved values. Images become SDK asset handles via `toAsset`
 * (uploaded lazily at submit), set on the loader node's file widget.
 */
export async function applyInputs(
  target: InputTarget,
  binding: WorkflowBinding,
  values: ResolvedInputs,
  toAsset: (file: File) => Promise<unknown> | unknown,
): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    const spec = binding.inputs[name];
    if (!spec) continue;
    target.setInput(spec.node, spec.field, value instanceof File ? await toAsset(value) : value);
  }
}
