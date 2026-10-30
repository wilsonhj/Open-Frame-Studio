#!/usr/bin/env node
/**
 * Fails if any model file referenced by workflows/*.api.json is missing from
 * models/manifest.json (or an entry lacks a required field). Owner: slice B.
 *
 *   pnpm check:models
 *   node scripts/check-models.mjs --verify <ComfyUI models dir>   # re-hash downloaded weights
 *
 * A "model file" is any string widget value ending in a weights extension.
 * Offline: never downloads anything. Only --verify hashes files, and only the
 * ones you point it at (<dir>/<folder>/<filename>, as ComfyUI lays them out).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    if (/minimax/i.test(String(entry.licence)) && /permissive/i.test(String(entry.licence)) && !/not permissive/i.test(String(entry.licence))) {
      problems.push(`models[${i}] (${entry.filename}): the MiniMax H3 licence is conditional, never "permissive"`);
    }
    if ("sizeBytes" in entry && !(Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes > 0)) problems.push(`models[${i}]: sizeBytes must be a positive integer`);
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

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Hash every manifest model found under `dir` (ComfyUI's models/ layout) and
 * compare size and sha256. Returns { ok, problems, missing }: a file that
 * isn't there is "missing", not a problem, so a partial install can be checked.
 */
export async function verifyModels(manifest, dir, { log = () => {} } = {}) {
  const ok = [];
  const problems = [];
  const missing = [];
  for (const entry of manifest.models ?? []) {
    const path = join(dir, entry.folder, entry.filename);
    if (!existsSync(path)) {
      missing.push(path);
      continue;
    }
    const size = statSync(path).size;
    if (entry.sizeBytes && size !== entry.sizeBytes) {
      problems.push(`${entry.filename}: ${size} bytes, expected ${entry.sizeBytes}`);
      continue;
    }
    log(`hashing ${entry.filename} (${(size / 1e9).toFixed(2)} GB)...`);
    const digest = await sha256File(path);
    if (entry.sha256 && digest !== entry.sha256) problems.push(`${entry.filename}: sha256 ${digest}, expected ${entry.sha256}`);
    else ok.push(entry.filename);
  }
  return { ok, problems, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "models/manifest.json"), "utf8"));
  const verify = process.argv.indexOf("--verify");
  if (verify !== -1) {
    const dir = process.argv[verify + 1];
    if (!dir) {
      console.error("usage: check-models.mjs --verify <ComfyUI models dir>");
      process.exit(2);
    }
    const { ok, problems, missing } = await verifyModels(manifest, dir, { log: console.log });
    for (const m of missing) console.warn(`not present: ${m}`);
    for (const p of problems) console.error(`error: ${p}`);
    console.log(`check:models --verify: ${ok.length} ok, ${problems.length} mismatched, ${missing.length} not present`);
    process.exit(problems.length ? 1 : 0);
  }
  const refs = referencedModels();
  const { problems, warnings } = checkModels(manifest, refs);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  console.log(`check:models ok: ${refs.size} model files referenced, all in models/manifest.json`);
}
