#!/usr/bin/env node
/**
 * One golden job per workflow: proves each graph runs on a backend and records
 * its outputs, timings and the exact graph that ran. Owner: slice B.
 *
 *   node scripts/golden-run.mjs                       # dry run (default): plan + offline checks, no network
 *   node scripts/golden-run.mjs --mock [--out DIR]    # full submit/poll/download path against tests/mock-comfy
 *   node scripts/golden-run.mjs --live --spend-credits --workflow cutout,klein_t2i [--balance]
 *   node scripts/golden-run.mjs --live --spend-credits --all [--balance]
 *
 * --live is billed. It refuses unless --spend-credits is given, a backend is
 * configured (COMFY_API_KEY for Comfy Cloud, or COMFY_BASE_URL for a
 * self-hosted proxy) and the workflows are named (--workflow a,b or --all).
 * Live records go to fixtures/golden/<workflow>/run.json, outputs beside them.
 *
 * Submit discipline (docs/PLAN.md, "traps"): the idempotency key is minted and
 * written to run.json before the POST. A re-run resumes a recorded job id by
 * polling (never re-POSTs it), re-sends an unconfirmed submit only under the
 * same key, and records a 422 key reuse with no job id as submit_unconfirmed
 * without ever submitting under a new key. SIGINT/SIGTERM during a pass
 * requests a cancel of the in-flight job, records it in run.json and exits
 * non-zero (130/143).
 *
 * Cost: Comfy reports no per-job cost for API v2 jobs. --balance reads
 * GET /api/billing/balance before and after the pass and records the delta,
 * labelled approximate (other usage in the same window counts too).
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ["--conditions=react-server", "--experimental-strip-types", "--no-warnings"];

const fixture = (name) => join(ROOT, "fixtures/products", name);

/**
 * The golden pass. `values` are bound inputs (lib/bindings); `images` maps an
 * image input to a fixture file. `cost` describes what the job asks the GPU
 * to do, for the report and for the user's go/no-go.
 */
export const GOLDEN = [
  {
    workflow: "image_resize_smoke",
    images: { image: fixture("product-mug-tiles.png") },
    values: { scale: 0.5, method: "lanczos" },
    timeoutMs: 5 * 60_000,
    cost: { models: [], work: "ImageScaleBy 0.5x of a 512x512 PNG (no model)", resolution: "256x256", count: 1 },
  },
  {
    workflow: "cutout",
    images: { image: fixture("product-bottle-confetti.png") },
    values: {},
    timeoutMs: 10 * 60_000,
    cost: { models: ["birefnet.safetensors"], work: "BiRefNet background removal, 1 pass", resolution: "512x512", count: 1 },
  },
  {
    workflow: "klein_t2i",
    images: {},
    values: { width: 768, height: 1024, batch_size: 1, steps: 4, seed: 101 },
    timeoutMs: 10 * 60_000,
    cost: { models: ["flux-2-klein-4b.safetensors"], work: "FLUX.2 Klein 4B distilled t2i, 4 steps, graph prompt", resolution: "768x1024", count: 1 },
  },
  {
    workflow: "klein_edit_multiref",
    // Product fixtures stand in for the face refs: the repo holds no faces (fixtures/README.md).
    images: {
      image_1: fixture("product-bottle-confetti.png"),
      image_2: fixture("product-mug-tiles.png"),
      image_3: fixture("product-box-checker.png"),
      image_4: fixture("product-bottle-transparent.png"),
    },
    values: {
      prompt: "A studio product photograph of the red bottle from image 1 on a light oak table, soft daylight.",
      width: 1024,
      height: 1024,
      batch_size: 1,
      steps: 4,
      seed: 1,
      ref_megapixels: 1.0,
    },
    timeoutMs: 10 * 60_000,
    cost: { models: ["flux-2-klein-4b.safetensors"], work: "FLUX.2 Klein 4B edit with 4 reference images (1.0 MP each), 4 steps", resolution: "1024x1024", count: 1 },
  },
  {
    workflow: "upscale",
    images: { image: fixture("product-box-checker.png") },
    values: { scale: 2.0, seed: 959948902156062, color_correction: "wavelet" },
    timeoutMs: 15 * 60_000,
    cost: { models: ["seedvr2_3b_int8_convrot.safetensors"], work: "SeedVR2 3B, 1 step, tiled VAE, 2x", resolution: "512x512 -> 1024x1024", count: 1 },
  },
  {
    workflow: "h3_r2v",
    images: { image_1: fixture("product-bottle-confetti.png"), image_2: fixture("product-mug-tiles.png") },
    values: {
      prompt: "A slow push-in on <Picture 1>, the red bottle, standing beside <Picture 2>, the blue mug, on a kitchen counter in morning light.",
      seed: 42,
      duration: 5.0,
      turbo: true,
      steps_turbo: 4,
      aspect_ratio: "9:16 (Portrait Widescreen)",
      megapixels: 0.4,
    },
    timeoutMs: 20 * 60_000,
    cost: {
      models: ["minimax_h3_ref2va_pruned_int8_convrot.safetensors", "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"],
      work: "MiniMax H3 reference-to-video with audio, turbo LoRA, 4 steps, 5 s at 24 fps (124 frames)",
      resolution: "0.4 MP 9:16 (480x864 output)",
      count: 1,
    },
  },
];

export function parseArgs(argv) {
  const args = { mode: "dry", out: null, workflows: null, all: false, spend: false, balance: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mock") args.mode = "mock";
    else if (a === "--live") args.mode = "live";
    else if (a === "--spend-credits") args.spend = true;
    else if (a === "--balance") args.balance = true;
    else if (a === "--all") args.all = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--workflow") args.workflows = String(argv[++i] ?? "").split(",").filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

/** Why a live run must not start (null = allowed). */
export function liveRefusal(args, env = process.env) {
  if (args.mode !== "live") return null;
  if (!args.spend) return "--live submits billed jobs: add --spend-credits to confirm.";
  if (!env.COMFY_API_KEY?.trim() && !env.COMFY_BASE_URL?.trim()) return "--live needs COMFY_API_KEY (Comfy Cloud) or COMFY_BASE_URL (self-hosted).";
  if (args.all && args.workflows?.length) return "--all and --workflow are exclusive: name the workflows or pass --all, not both.";
  if (!args.all && !args.workflows?.length) return "--live needs --workflow a,b or --all.";
  return null;
}

export function selectPlan(args, plan = GOLDEN) {
  if (args.all && args.workflows?.length) throw new Error("--all and --workflow are exclusive: name the workflows or pass --all, not both.");
  if (!args.workflows?.length) return plan;
  const unknown = args.workflows.filter((w) => !plan.some((p) => p.workflow === w));
  if (unknown.length) throw new Error(`unknown workflow(s): ${unknown.join(", ")}`);
  return plan.filter((p) => args.workflows.includes(p.workflow));
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The graph a golden job submits, with placeholder filenames for images (dry run) or asset handles. */
async function buildGraph(entry, imageValue) {
  const { getBinding } = await import("../lib/bindings/index.ts");
  const { applyBindings } = await import("../lib/bindings/apply.ts");
  const { loadGraph } = await import("../lib/comfy.ts");
  const binding = getBinding(entry.workflow);
  const values = { ...entry.values };
  for (const [name, path] of Object.entries(entry.images)) values[name] = await imageValue(name, path);
  return { binding, graph: applyBindings(await loadGraph(entry.workflow), binding, values) };
}

/** Dry run: bind every golden entry and check the result offline. Returns problems. */
export async function dryRun(plan = GOLDEN) {
  const oi = await import("./check-object-info.mjs");
  const { nodes } = oi.loadSnapshot();
  const problems = [];
  for (const entry of plan) {
    for (const path of Object.values(entry.images)) if (!existsSync(path)) problems.push(`${entry.workflow}: missing fixture ${path}`);
    // Image widgets take uploads: a placeholder name keeps the graph checkable offline.
    const { graph } = await buildGraph(entry, (name) => `golden_${name}.png`);
    problems.push(...oi.checkGraph(entry.workflow, graph, nodes));
  }
  return problems;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The job runOne is waiting on, for the signal handler: { client, record, recordPath }. */
let inFlight = null;
/** Set synchronously on the first SIGINT/SIGTERM so the plan loop stops before the next billed job. */
let stopPass = false;

const SETTLED_JOB = new Set(["succeeded", "failed", "canceled", "expired"]);

/**
 * SIGINT/SIGTERM handler for a live pass: cancel the in-flight job (if it has
 * an id), record that in run.json and exit non-zero. A second signal exits
 * immediately; the first one also raises stopPass before awaiting cancel, so
 * the plan loop does not submit the next workflow while cancel is in flight.
 * Dependencies are injected so the logic is testable without a network or a real signal.
 */
export function makeSignalHandler({ getInFlight, cancel, write = writeJson, exit = (code) => process.exit(code), log = console.error }) {
  let handling = false;
  return async (signal) => {
    const code = signal === "SIGINT" ? 130 : 143;
    if (handling) return exit(code);
    handling = true;
    stopPass = true;
    const current = getInFlight();
    if (!current) {
      log(`golden-run: ${signal}; no job in flight`);
      return exit(code);
    }
    const { record, recordPath } = current;
    record.interrupted = { signal, at: new Date().toISOString() };
    if (record.jobId) {
      const result = await cancel(record.jobId, current);
      record.interrupted.cancel = { outcome: result.outcome, ...(result.error ? { error: result.error } : {}) };
      if (result.job) record.status = result.job.status;
      log(`golden-run: ${signal}; ${record.workflow} job ${record.jobId}: ${result.outcome}`);
    } else {
      log(`golden-run: ${signal}; ${record.workflow} had no job id yet (re-run resumes under the same idempotency key)`);
    }
    write(recordPath, record);
    return exit(code);
  };
}

/** Run one golden job end to end against the configured backend. */
export async function runOne(entry, { outDir, log = console.log }) {
  const comfy = await import("../lib/comfy.ts");
  const dir = join(outDir, entry.workflow);
  const recordPath = join(dir, "run.json");
  const previous = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  const client = comfy.createClient();
  const inputs = {};
  const { binding, graph } = await buildGraph(entry, (name, path) => {
    const bytes = readFileSync(path);
    inputs[name] = { fixture: path.slice(ROOT.length + 1), sha256: sha256(bytes), bytes: bytes.byteLength };
    return client.assets.fromBytes(new Uint8Array(bytes), { filename: `${name}.png`, contentType: "image/png" });
  });

  const record = {
    workflow: entry.workflow,
    backend: comfy.apiOrigin(),
    values: entry.values,
    inputs,
    cost: entry.cost,
    graphSha256: sha256(JSON.stringify(graph)),
    // Reuse a recorded key: a re-send under it can't create a second job.
    idempotencyKey: previous?.idempotencyKey ?? randomUUID(),
    jobId: previous?.jobId ?? null,
    status: previous?.status ?? "pending",
    startedAt: new Date().toISOString(),
  };
  if (previous?.terminal) {
    log(`${entry.workflow}: already finished (${previous.status}); delete ${recordPath} to run again`);
    return previous;
  }
  // Persist the key before the POST, so a crash can only ever re-send under it.
  writeJson(recordPath, record);
  inFlight = { client, record, recordPath };
  try {
    return await submitAndCollect({ comfy, client, entry, binding, graph, record, recordPath, dir, outDir, log });
  } finally {
    inFlight = null;
  }
}

async function submitAndCollect({ comfy, client, entry, binding, graph, record, recordPath, dir, outDir, log }) {

  const t0 = Date.now();
  if (!record.jobId) {
    try {
      const job = await comfy.submitOnce(client, client.workflows.fromJson(graph), { idempotencyKey: record.idempotencyKey });
      record.jobId = job.id;
      record.status = job.status;
    } catch (error) {
      const reused = error instanceof comfy.SubmitRejectedError && error.keyReused;
      record.status = reused ? "submit_unconfirmed" : error instanceof comfy.SubmitAmbiguousError ? "submit_ambiguous" : "submit_rejected";
      record.error = { message: error instanceof Error ? error.message : String(error), code: error?.code ?? null, httpStatus: error?.httpStatus ?? null };
      record.terminal = record.status !== "submit_ambiguous";
      writeJson(recordPath, record);
      log(`${entry.workflow}: ${record.status} (${record.error.message})`);
      return record;
    }
    writeJson(recordPath, record);
  }

  let firstRunningAt = null;
  const job = await comfy.pollJob(client, record.jobId, {
    timeoutMs: entry.timeoutMs,
    onUpdate: (j) => {
      if (firstRunningAt === null && j.status === "running") firstRunningAt = Date.now();
    },
  });
  const t1 = Date.now();
  record.status = job.status;
  // pollJob sets terminal on poll_timeout even when the job is still live
  // (cancel requested or cancel failed). Only a settled status is finished.
  record.terminal = SETTLED_JOB.has(job.status);
  record.error = job.error;
  record.timing = {
    wallMs: t1 - t0,
    queuedMs: firstRunningAt === null ? null : firstRunningAt - t0,
    runningMs: firstRunningAt === null ? null : t1 - firstRunningAt,
    note: "Observed by polling (resolution ~0.5-5 s); not Comfy's server-side execution metrics.",
  };
  record.outputs = [];
  const declared = new Set(Object.values(binding.outputs));
  for (const output of job.outputs) {
    if (!declared.has(output.nodeId)) continue;
    const file = join(dir, `${output.nodeId}_${output.name}`.replace(/[^\w.-]/g, "_"));
    await comfy.saveOutput(client, record.jobId, output.id, file);
    const bytes = readFileSync(file);
    record.outputs.push({ nodeId: output.nodeId, name: output.name, contentType: output.contentType, bytes: bytes.byteLength, sha256: sha256(bytes), file: file.slice(outDir.length + 1) });
  }
  record.finishedAt = new Date().toISOString();
  writeJson(recordPath, record);
  log(`${entry.workflow}: ${record.status} in ${(record.timing.wallMs / 1000).toFixed(1)} s, ${record.outputs.length} output(s)`);
  return record;
}

/** GET /api/billing/balance (Comfy Cloud, read-only). null when unavailable. */
async function readBalance() {
  const key = process.env.COMFY_API_KEY?.trim();
  if (!key || process.env.COMFY_BASE_URL?.trim()) return null;
  try {
    const res = await fetch("https://cloud.comfy.org/api/billing/balance", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const body = await res.json();
    return { at: new Date().toISOString(), raw: body };
  } catch {
    return null;
  }
}

export function formatPlan(plan) {
  const rows = plan.map((e) => `  ${e.workflow.padEnd(20)} ${String(e.cost.count).padStart(2)} job  ${e.cost.resolution.padEnd(24)} ${e.cost.work}`);
  return [`golden pass: ${plan.length} workflow(s), ${plan.reduce((n, e) => n + e.cost.count, 0)} job(s)`, ...rows].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refusal = liveRefusal(args);
  if (refusal) {
    console.error(`golden-run: ${refusal}`);
    process.exit(2);
  }
  const plan = selectPlan(args);
  console.log(formatPlan(plan));

  const problems = await dryRun(plan);
  if (problems.length) {
    console.error(`golden-run: ${problems.length} offline problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  if (args.mode === "dry") {
    console.log("golden-run: dry run ok (nothing submitted). Use --mock, or --live --spend-credits.");
    return;
  }

  let mock = null;
  if (args.mode === "mock") {
    const { startMockComfy } = await import("../tests/mock-comfy/server.ts");
    mock = await startMockComfy({ port: 0, scenario: "succeeded" });
    process.env.COMFY_BASE_URL = mock.url;
    delete process.env.COMFY_API_KEY;
  }
  const outDir = args.out ?? (args.mode === "live" ? join(ROOT, "fixtures/golden") : join(tmpdir(), `golden-mock-${Date.now()}`));
  const before = args.balance ? await readBalance() : null;
  const results = [];
  const comfy = await import("../lib/comfy.ts");
  stopPass = false;
  const onSignal = makeSignalHandler({ getInFlight: () => inFlight, cancel: (jobId, { client }) => comfy.requestCancel(client, jobId) });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, onSignal);
  try {
    for (const entry of plan) {
      if (stopPass) break;
      const result = await runOne(entry, { outDir });
      results.push(result);
      // A timed-out job that is still live must not be followed by another billed submit.
      if (stopPass || (result.error?.code === "poll_timeout" && result.terminal === false)) break;
    }
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, onSignal);
    await mock?.close();
  }
  const after = args.balance ? await readBalance() : null;
  const summary = {
    mode: args.mode,
    at: new Date().toISOString(),
    results: results.map((r) => ({ workflow: r.workflow, status: r.status, wallMs: r.timing?.wallMs ?? null, outputs: r.outputs?.length ?? 0 })),
    balance: before && after ? { before, after, note: "Approximate: the account's balance delta over the pass; other usage in the window counts too." } : "not reported",
  };
  writeJson(join(outDir, "summary.json"), summary);
  console.log(`golden-run: wrote ${join(outDir, "summary.json")}`);
  if (results.some((r) => r.status !== "succeeded")) process.exit(1);
}

if (process.argv[1] === SELF) {
  // lib/ is TypeScript behind `server-only`: re-exec with the flags the tests use.
  if (!FLAGS.slice(0, 2).every((f) => process.execArgv.includes(f))) {
    // Async spawn, so a SIGINT/SIGTERM sent to this pid reaches the child, which cancels its in-flight job.
    const child = spawn(process.execPath, [...FLAGS, SELF, ...process.argv.slice(2)], { stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("exit", (code, signal) => process.exit(code ?? (signal === "SIGINT" ? 130 : 1)));
  } else {
    main().catch((error) => {
      console.error(`golden-run: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
  }
}
