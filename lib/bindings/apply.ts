/**
 * Pure helpers that apply logical input values to an API-format graph via a
 * GraphBinding. No I/O and no SDK dependency, so it runs under `node --test`.
 */
import type { GraphBinding, GraphInputBinding, GraphTarget, GraphValue } from "../types.ts";

export class BindingError extends Error {
  readonly input: string | null;
  constructor(message: string, input: string | null = null) {
    super(message);
    this.name = "BindingError";
    this.input = input;
  }
}

/** API-format graph: `{ [nodeId]: { class_type, inputs } }`. */
export type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; [key: string]: unknown }>;

export type BindingValues = Record<string, GraphValue>;

/** One resolved assignment, usable with an SDK Workflow's `setInput`. */
export type Assignment = GraphTarget & { input: string; value: GraphValue };

/** Validate `values` against the binding and expand them to node/field assignments (mirrors included). */
export function resolveAssignments(binding: GraphBinding, values: BindingValues): Assignment[] {
  const assignments: Assignment[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(binding.inputs, name)) {
      throw new BindingError(`Unknown input "${name}" for workflow ${binding.workflow}.`, name);
    }
    const spec = binding.inputs[name];
    checkKind(name, spec, value);
    for (const target of [spec, ...(spec.mirrors ?? [])]) {
      assignments.push({ input: name, node: target.node, field: target.field, value });
    }
  }
  return assignments;
}

/**
 * Return a new graph (structuredClone) with `values` applied. Throws
 * BindingError for an unknown logical name, a wrong value kind, or a binding
 * whose node/field is missing from the graph or is a link (binding drift).
 */
export function applyBindings<G extends ApiGraph>(graph: G, binding: GraphBinding, values: BindingValues): G {
  const assignments = resolveAssignments(binding, values);
  const next = structuredClone(graph);
  for (const { input, node, field, value } of assignments) {
    const target = Object.hasOwn(next, node) ? next[node] : undefined;
    if (!target || typeof target.inputs !== "object" || target.inputs === null) {
      throw new BindingError(`Input "${input}" targets node ${node}, which is not in ${binding.workflow}.`, input);
    }
    if (!Object.hasOwn(target.inputs, field)) {
      throw new BindingError(`Input "${input}" targets ${node}.${field}, which ${binding.workflow} does not have.`, input);
    }
    if (Array.isArray(target.inputs[field])) {
      throw new BindingError(`Input "${input}" targets ${node}.${field}, which is a link, not a widget.`, input);
    }
    target.inputs[field] = value;
  }
  return next;
}

/** Check every binding target exists as a widget in the graph. Returns problems (empty = ok). */
export function checkBinding(graph: ApiGraph, binding: GraphBinding): string[] {
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(binding.inputs)) {
    for (const { node, field } of [spec, ...(spec.mirrors ?? [])]) {
      const target = Object.hasOwn(graph, node) ? graph[node] : undefined;
      if (!target) problems.push(`${name}: node ${node} missing`);
      else if (!Object.hasOwn(target.inputs, field)) problems.push(`${name}: ${node}.${field} missing`);
      else if (Array.isArray(target.inputs[field])) problems.push(`${name}: ${node}.${field} is a link`);
    }
  }
  for (const [name, node] of Object.entries(binding.outputs)) {
    if (!Object.hasOwn(graph, node)) problems.push(`output ${name}: node ${node} missing`);
  }
  return problems;
}

function checkKind(name: string, spec: GraphInputBinding, value: GraphValue): void {
  const ok = (() => {
    switch (spec.kind) {
      case "image":
        return (typeof value === "string" && value.trim() !== "") || (typeof value === "object" && value !== null);
      case "text":
        return typeof value === "string";
      case "int":
        return typeof value === "number" && Number.isSafeInteger(value);
      case "float":
        return typeof value === "number" && Number.isFinite(value);
      case "bool":
        return typeof value === "boolean";
      default:
        return false;
    }
  })();
  if (!ok) throw new BindingError(`Input "${name}" must be ${KIND_LABEL[spec.kind]}.`, name);
}

const KIND_LABEL: Record<GraphInputBinding["kind"], string> = {
  image: "an image filename, asset id or asset handle",
  text: "a string",
  int: "an integer",
  float: "a finite number",
  bool: "a boolean",
};
