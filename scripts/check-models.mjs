#!/usr/bin/env node
/**
 * Fails if any model file referenced by workflows/*.api.json is missing from
 * models/manifest.json (or an entry lacks a required field). Owner: slice B.
 *
 *   pnpm check:models
 *
 * A "model file" is any string widget value ending in a weights extension.
 * Offline: never downloads or hashes anything.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WEIGHTS = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i;
// upstream and licenceUrl are read by the landing page (app/page.tsx).
const REQUIRED = ["filename", "folder", "workflows", "role", "source", "upstream", "licence", "licenceUrl", "sha256", "cloudAvailable"];

/** filename -> Set of workflow names that reference it. */
export function referencedModels(dir = join(ROOT, "workflows")) {
  const refs = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".api.json")).sort()) {
    const workflow = file.slice(0, -".api.json".length);
    const graph = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const node of Object.values(graph)) {
      for (const value of Object.values(node?.inputs ?? {})) {
        if (typeof value === "string" && WEIGHTS.test(value)) {
          if (!refs.has(value)) refs.set(value, new Set());
          refs.get(value).add(workflow);
        }
      }
    }
  }
  return refs;
}

export function checkModels(manifest, refs) {
  const problems = [];
  const warnings = [];
  const entries = new Map();
  for (const [i, entry] of (manifest.models ?? []).entries()) {
    for (const key of REQUIRED) {
      if (!(key in entry)) problems.push(`models[${i}] (${entry.filename ?? "?"}): missing "${key}"`);
    }
    if (entry.source && (!entry.source.repo || !entry.source.url)) problems.push(`models[${i}]: source needs repo and url`);
    if ("upstream" in entry && (!entry.upstream?.repo || !entry.upstream?.url)) problems.push(`models[${i}]: upstream needs repo and url`);
    for (const key of ["licence", "licenceUrl"]) {
      if (key in entry && (typeof entry[key] !== "string" || !entry[key].trim())) problems.push(`models[${i}]: ${key} must be a non-empty string`);
    }
    if (entry.sha256 !== null && !/^[0-9a-f]{64}$/.test(String(entry.sha256))) problems.push(`models[${i}]: sha256 must be null or 64 hex chars`);
    if (entries.has(entry.filename)) problems.push(`duplicate manifest entry: ${entry.filename}`);
    entries.set(entry.filename, entry);
  }
  for (const [filename, workflows] of refs) {
    const entry = entries.get(filename);
    if (!entry) {
      problems.push(`${filename} (used by ${[...workflows].join(", ")}) is missing from models/manifest.json`);
      continue;
    }
    for (const w of workflows) {
      if (!entry.workflows?.includes(w)) problems.push(`${filename}: manifest "workflows" lacks ${w}`);
    }
  }
  for (const filename of entries.keys()) {
    if (!refs.has(filename)) warnings.push(`${filename} is in the manifest but no workflow uses it`);
  }
  return { problems, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "models/manifest.json"), "utf8"));
  const refs = referencedModels();
  const { problems, warnings } = checkModels(manifest, refs);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  console.log(`check:models ok: ${refs.size} model files referenced, all in models/manifest.json`);
}
