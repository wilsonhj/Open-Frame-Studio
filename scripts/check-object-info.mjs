#!/usr/bin/env node
/**
 * Checks every workflows/*.api.json against a saved Comfy Cloud object_info
 * snapshot (fixtures/golden/object_info.cloud.json). Owner: slice B.
 *
 *   node scripts/check-object-info.mjs                 # offline, against the snapshot
 *   node scripts/check-object-info.mjs --refresh FILE  # rebuild the snapshot from a saved
 *                                                      # GET /api/object_info response
 *
 * --refresh keeps only the model filenames the workflows use at refresh time:
 * to switch models, edit the workflow, then refresh from a full response.
 *
 * Per node it checks: the class exists, is not a partner (API) node and is not
 * deprecated; every literal widget is a known input of the right type, inside
 * its min/max, and one of its COMBO options; every link points at an existing
 * node and a valid output slot whose type the input accepts (`*`, "A,B"
 * unions and V3 match types allowed); every required input is set. Dotted keys
 * are V3 dynamic inputs: `parent.child` resolves through the selected
 * COMFY_DYNAMICCOMBO_V3 option (whose own required inputs must be set) or the
 * COMFY_AUTOGROW_V3 template (children named from `names` or `<prefix><n>`,
 * within min/max).
 *
 * Offline: never calls the network. --refresh reads a file you fetched
 * yourself (a read-only GET; see docs/spikes/golden-runs.md).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
export const SNAPSHOT_PATH = join(ROOT, "fixtures/golden/object_info.cloud.json");
/** COMBO lists that are mostly filenames (model folders) are kept only for values the workflows use. */
const LONG_COMBO = 50;
const FILE_LIKE = /(\/|\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft|json|model|png|jpe?g|webp))$/i;
const isFileList = (options) =>
  options.length > LONG_COMBO && options.filter((o) => typeof o === "string" && FILE_LIKE.test(o)).length * 2 >= options.length;

/** name -> graph for every workflows/*.api.json. */
export function loadWorkflows(dir = join(ROOT, "workflows")) {
  const graphs = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".api.json")).sort()) {
    graphs[file.slice(0, -".api.json".length)] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return graphs;
}

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isInteger(v[1]);

/** [type, options] for an object_info input spec; COMBO lists come back as ["COMBO", {options}]. */
function normalize(spec) {
  if (!Array.isArray(spec)) return [undefined, {}];
  const [type, opts = {}] = spec;
  if (Array.isArray(type)) return ["COMBO", { ...opts, options: type }];
  return [type, opts];
}

function specsOf(input) {
  return { ...(input?.required ?? {}), ...(input?.optional ?? {}) };
}

/** Resolve the spec for a (possibly dotted) input key. undefined = unknown input. */
function resolveSpec(info, inputs, key) {
  const specs = specsOf(info.input);
  const dot = key.indexOf(".");
  if (dot === -1) return specs[key];
  const parent = key.slice(0, dot);
  const child = key.slice(dot + 1);
  const [ptype, popts] = normalize(specs[parent]);
  if (ptype === "COMFY_DYNAMICCOMBO_V3") {
    const option = (popts.options ?? []).find((o) => o?.key === inputs[parent]);
    return option ? resolveDotted(specsOf(option.inputs), child) : undefined;
  }
  if (ptype === "COMFY_AUTOGROW_V3") {
    if (!isAutogrowChild(popts.template, child)) return undefined;
    const only = Object.values(specsOf(popts.template?.input));
    return only.length === 1 ? only[0] : ["*", {}];
  }
  return undefined;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Autogrow children are named from the template: one of `names`, or `<prefix><n>`. */
function isAutogrowChild(template, child) {
  if (Array.isArray(template?.names)) return template.names.includes(child);
  if (typeof template?.prefix === "string") return new RegExp(`^${escapeRegExp(template.prefix)}\\d+$`).test(child);
  return false;
}

/** Socket types a spec accepts from a link; null = any. Handles `*`, "A,B" unions and V3 match types. */
function acceptedTypes(spec) {
  const [type, opts] = normalize(spec);
  if (type === "COMFY_MATCHTYPE_V3") return typeList(opts.template?.allowed_types);
  return typeList(type);
}

function typeList(type) {
  if (typeof type !== "string") return null;
  const list = type.split(",").map((t) => t.trim()).filter(Boolean);
  return list.length === 0 || list.includes("*") ? null : new Set(list);
}

/** Types an output slot can carry; null = any. A V3 match-type output carries whatever its match-type inputs allow. */
function outputTypes(info, slot) {
  const out = info.output?.[slot];
  if (Array.isArray(out)) return new Set(["COMBO"]);
  if (out !== "COMFY_MATCHTYPE_V3") return typeList(out);
  const allowed = new Set();
  for (const spec of Object.values(specsOf(info.input))) {
    const [type] = normalize(spec);
    if (type !== "COMFY_MATCHTYPE_V3") continue;
    const types = acceptedTypes(spec);
    if (types === null) return null;
    for (const t of types) allowed.add(t);
  }
  return allowed.size ? allowed : null;
}

function resolveDotted(specs, key) {
  const dot = key.indexOf(".");
  return dot === -1 ? specs[key] : undefined;
}

function checkLiteral(where, spec, value) {
  const [type, opts] = normalize(spec);
  const problems = [];
  const range = () => {
    if (opts.min !== undefined && value < opts.min) problems.push(`${where}: ${value} < min ${opts.min}`);
    if (opts.max !== undefined && value > opts.max) problems.push(`${where}: ${value} > max ${opts.max}`);
  };
  switch (type) {
    case "INT":
      if (!Number.isInteger(value)) problems.push(`${where}: expected INT, got ${JSON.stringify(value)}`);
      else range();
      break;
    case "FLOAT":
      if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${where}: expected FLOAT, got ${JSON.stringify(value)}`);
      else range();
      break;
    case "BOOLEAN":
      if (typeof value !== "boolean") problems.push(`${where}: expected BOOLEAN, got ${JSON.stringify(value)}`);
      break;
    case "STRING":
      if (typeof value !== "string") problems.push(`${where}: expected STRING, got ${JSON.stringify(value)}`);
      break;
    case "COMBO":
    case "COMFY_DYNAMICCOMBO_V3": {
      if (opts.image_upload) break; // upload widgets accept any uploaded file
      const options = (opts.options ?? []).map((o) => (typeof o === "object" && o !== null ? o.key : o));
      if (!options.includes(value)) {
        problems.push(
          opts._trimmed
            ? `${where}: ${JSON.stringify(value)} was not available on Comfy Cloud at snapshot time`
            : `${where}: ${JSON.stringify(value)} is not one of ${options.length} options`,
        );
      }
      break;
    }
    default:
      // A socket type (MODEL, IMAGE, ...) given a literal instead of a link.
      if (type && type === type.toUpperCase() && !["*"].includes(type)) problems.push(`${where}: ${type} input needs a link, got a literal`);
  }
  return problems;
}

/** Problems for one graph against an object_info map (empty = ok). */
export function checkGraph(name, graph, objectInfo) {
  const problems = [];
  for (const [id, node] of Object.entries(graph)) {
    const where = `${name} #${id} ${node.class_type}`;
    const info = objectInfo[node.class_type];
    if (!info) {
      problems.push(`${where}: node class not on Comfy Cloud`);
      continue;
    }
    if (info.api_node) problems.push(`${where}: partner (API) node; not allowed`);
    if (info.deprecated) problems.push(`${where}: deprecated node`);
    for (const [key, value] of Object.entries(node.inputs ?? {})) {
      const spec = resolveSpec(info, node.inputs, key);
      if (spec === undefined) {
        problems.push(`${where}: unknown input "${key}"`);
        continue;
      }
      if (isLink(value)) {
        const source = graph[value[0]];
        const sourceInfo = source && objectInfo[source.class_type];
        if (!source) problems.push(`${where}.${key}: links to missing node ${value[0]}`);
        else if (Array.isArray(sourceInfo?.output)) {
          if (value[1] >= sourceInfo.output.length) {
            problems.push(`${where}.${key}: ${source.class_type} has no output slot ${value[1]}`);
          } else {
            const accepts = acceptedTypes(spec);
            const carries = outputTypes(sourceInfo, value[1]);
            if (accepts && carries && ![...carries].some((t) => accepts.has(t))) {
              problems.push(`${where}.${key}: expects ${[...accepts].join(",")}, but ${source.class_type} output ${value[1]} is ${[...carries].join(",")}`);
            }
          }
        }
      } else {
        problems.push(...checkLiteral(`${where}.${key}`, spec, value));
      }
    }
    for (const key of Object.keys(info.input?.required ?? {})) {
      const [type] = normalize(info.input.required[key]);
      if (!(key in (node.inputs ?? {})) && !Object.keys(node.inputs ?? {}).some((k) => k.startsWith(`${key}.`)) && type !== "COMFY_AUTOGROW_V3") {
        problems.push(`${where}: required input "${key}" not set`);
      }
    }
    problems.push(...checkDynamicInputs(where, info, node.inputs ?? {}));
  }
  return problems;
}

/** Required inputs of each selected dynamic-combo option, and autogrow child counts. */
function checkDynamicInputs(where, info, inputs) {
  const problems = [];
  const required = info.input?.required ?? {};
  for (const [param, spec] of Object.entries(specsOf(info.input))) {
    const [type, opts] = normalize(spec);
    if (type === "COMFY_DYNAMICCOMBO_V3" && param in inputs) {
      const option = (opts.options ?? []).find((o) => o?.key === inputs[param]);
      for (const key of Object.keys(option?.inputs?.required ?? {})) {
        if (!(`${param}.${key}` in inputs)) problems.push(`${where}: required input "${param}.${key}" not set (${param} = ${JSON.stringify(inputs[param])})`);
      }
    }
    if (type === "COMFY_AUTOGROW_V3") {
      const template = opts.template ?? {};
      const count = Object.keys(inputs).filter((k) => k.startsWith(`${param}.`)).length;
      const max = template.max ?? template.names?.length;
      if (max !== undefined && count > max) problems.push(`${where}: ${count} "${param}" inputs, max ${max}`);
      // An absent optional autogrow is fine; once used (or when required) it needs its minimum.
      if (template.min !== undefined && count < template.min && (count > 0 || param in required)) {
        problems.push(`${where}: ${count} "${param}" input(s), min ${template.min}`);
      }
    }
  }
  return problems;
}

export function checkAll(graphs, objectInfo) {
  return Object.entries(graphs).flatMap(([name, graph]) => checkGraph(name, graph, objectInfo));
}

/** Model filename -> whether the snapshot lists it in some loader's COMBO. */
export function cloudModels(objectInfo) {
  const seen = new Set();
  for (const info of Object.values(objectInfo)) {
    for (const spec of Object.values(specsOf(info.input))) {
      const [type, opts] = normalize(spec);
      if (type === "COMBO") for (const o of opts.options ?? []) if (typeof o === "string") seen.add(o);
    }
  }
  return seen;
}

/** Trim a full object_info response to the classes the workflows use. */
export function trimObjectInfo(full, graphs) {
  const used = new Set();
  const values = new Set();
  for (const graph of Object.values(graphs)) {
    for (const node of Object.values(graph)) {
      used.add(node.class_type);
      for (const v of Object.values(node.inputs ?? {})) if (typeof v === "string") values.add(v);
    }
  }
  const trimCombos = (input) => {
    if (!input) return input;
    const out = {};
    for (const [section, specs] of Object.entries(input)) {
      if (typeof specs !== "object" || specs === null) {
        out[section] = specs;
        continue;
      }
      out[section] = {};
      for (const [key, spec] of Object.entries(specs)) {
        const [type, opts] = normalize(spec);
        // Upload widgets list the account's own uploaded files: never keep those.
        if (type === "COMBO" && opts.image_upload) {
          out[section][key] = ["COMBO", { ...opts, options: [], _trimmed: true }];
        } else if (type === "COMBO" && isFileList(opts.options ?? [])) {
          out[section][key] = ["COMBO", { ...opts, options: opts.options.filter((o) => values.has(o)), _trimmed: true }];
        } else out[section][key] = spec;
      }
    }
    return out;
  };
  const snapshot = {};
  for (const name of [...used].sort()) {
    const info = full[name];
    if (!info) continue;
    snapshot[name] = {
      input: trimCombos(info.input),
      output: info.output,
      output_name: info.output_name,
      python_module: info.python_module,
      ...(info.api_node ? { api_node: true } : {}),
      ...(info.deprecated ? { deprecated: true } : {}),
    };
  }
  return snapshot;
}

export function loadSnapshot(path = SNAPSHOT_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const graphs = loadWorkflows();
  const refresh = process.argv.indexOf("--refresh");
  if (refresh !== -1) {
    const file = process.argv[refresh + 1];
    if (!file) {
      console.error("usage: check-object-info.mjs --refresh <object_info.json>");
      process.exit(2);
    }
    const full = JSON.parse(readFileSync(file, "utf8"));
    const snapshot = { _meta: { source: "GET https://cloud.comfy.org/api/object_info", fetchedAt: new Date().toISOString(), classes: Object.keys(full).length }, nodes: trimObjectInfo(full, graphs) };
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 1)}\n`);
    console.log(`wrote ${SNAPSHOT_PATH} (${Object.keys(snapshot.nodes).length} node classes)`);
  }
  const { _meta, nodes } = loadSnapshot();
  const problems = checkAll(graphs, nodes);
  if (problems.length) {
    console.error(`check-object-info: ${problems.length} problem(s) against the ${_meta?.fetchedAt ?? "?"} snapshot:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-object-info: ok (${Object.keys(graphs).length} workflows, snapshot ${_meta?.fetchedAt ?? "?"})`);
}
