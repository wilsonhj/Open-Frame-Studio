#!/usr/bin/env node
/**
 * Live-demo launcher (slice G). Starts the Runtime-owned mock Comfy server
 * (tests/mock-comfy/server.ts, imported unmodified) on 127.0.0.1:8199 and
 * makes its succeeded jobs return real-looking PNGs, then runs `next dev`
 * with COMFY_BASE_URL pointing at it. Never contacts Comfy Cloud.
 *
 * How the images get in without editing the mock: the mock stores a job's
 * output lazily as asset `out-<jobId>` and keeps an existing entry. A small
 * front proxy on :8199 forwards to the mock and, the moment a job is
 * created, pre-fills `out-<jobId>` with a composited "product photo": the
 * job's uploaded input image on a studio backdrop with a soft shadow.
 *
 *   pnpm demo                     # mock on :8199 + next dev on :3000
 *   DEMO_PORT=8199 PORT=3000 ...  # overrides
 *   DEMO_NO_NEXT=1 pnpm demo      # mock only
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderFrame } from "./demo-images.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 8199);
const APP_PORT = Number(process.env.PORT ?? 3000);

const { startMockComfy, assetIdsIn } = await import(join(root, "tests/mock-comfy/server.ts"));
const mock = await startMockComfy({ port: 0, scenario: "succeeded" });
const upstream = new URL(mock.url);

/** outId -> the original (uploaded) source bytes, so chained steps reuse the product, not a composite. */
const sourceOf = new Map();
let frame = 0;

/** First non-output image the job references, followed back through earlier outputs. */
function sourceImage(workflow) {
  for (const id of assetIdsIn(workflow)) {
    if (sourceOf.has(id)) return sourceOf.get(id);
    const asset = mock.state.assets.get(id);
    if (asset && /^image\//.test(asset.contentType)) return asset.bytes;
  }
  return null;
}

/** Workflow class types, to tint cutout/upscale steps differently from shots. */
function classTypes(workflow) {
  if (!workflow || typeof workflow !== "object") return [];
  return Object.values(workflow)
    .map((node) => (node && typeof node === "object" ? node.class_type : null))
    .filter((t) => typeof t === "string");
}

async function prefillOutput(jobId) {
  const job = mock.state.jobs.get(jobId);
  if (!job) return;
  const source = sourceImage(job.workflow);
  const types = classTypes(job.workflow).join(" ");
  const seedNode = Object.values(job.workflow ?? {}).find((n) => n?.inputs && "seed" in n.inputs);
  const seed = Number(seedNode?.inputs?.seed ?? createHash("sha1").update(jobId).digest().readUInt32BE(0));
  const variant = /birefnet|removebackground|removebg|cutout/i.test(types) ? "cutout" : "shot";
  // The mock has no background-removal model: a cutout passes the upload through
  // unchanged, so only a product photo that already has transparency passes A4.
  const bytes = variant === "cutout" && source ? source : await renderFrame({ source, seed, index: frame++, variant });
  const outId = `out-${jobId}`;
  mock.state.assets.set(outId, {
    id: outId,
    hash: null,
    bytes,
    contentType: "image/png",
    filePath: `open-soul-studio/demo_${String(frame).padStart(5, "0")}_.png`,
    jobId,
  });
  if (source) sourceOf.set(outId, source);
}

const proxy = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const out = httpRequest(
      { host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: { ...req.headers, host: upstream.host } },
      (upRes) => {
        const parts = [];
        upRes.on("data", (c) => parts.push(c));
        upRes.on("end", async () => {
          let payload = Buffer.concat(parts);
          const isJobCreate = req.method === "POST" && req.url?.startsWith("/api/v2/jobs") && upRes.statusCode === 201;
          if (isJobCreate) {
            try {
              await prefillOutput(JSON.parse(payload.toString()).id);
            } catch (error) {
              console.error("[demo] could not render output:", error instanceof Error ? error.message : error);
            }
          }
          // Absolute URLs in JSON point at the inner mock; rewrite them to the proxy.
          if (String(upRes.headers["content-type"] ?? "").includes("application/json")) {
            payload = Buffer.from(payload.toString().replaceAll(mock.url, `http://127.0.0.1:${DEMO_PORT}`));
          }
          const headers = { ...upRes.headers, "content-length": String(payload.length) };
          if (headers.location) headers.location = String(headers.location).replace(mock.url, `http://127.0.0.1:${DEMO_PORT}`);
          res.writeHead(upRes.statusCode ?? 502, headers);
          res.end(payload);
        });
      },
    );
    out.on("error", (error) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "demo_proxy", message: error.message } }));
    });
    out.end(body);
  });
});

await new Promise((resolve) => proxy.listen(DEMO_PORT, "127.0.0.1", resolve));
const mockUrl = `http://127.0.0.1:${DEMO_PORT}`;
console.log(`[demo] mock Comfy API v2 on ${mockUrl} (composited PNG outputs; no Comfy Cloud calls)`);

let next = null;
if (!process.env.DEMO_NO_NEXT) {
  // A placeholder key keeps any "key required" checks quiet; the mock ignores it.
  // A real COMFY_API_KEY from the environment is dropped so it can never reach anything.
  const env = { ...process.env, COMFY_BASE_URL: mockUrl, COMFY_API_KEY: "demo-local-mock", OSS_DEMO: "1" };
  next = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(APP_PORT)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  next.on("exit", (code) => shutdown(code ?? 0));
  console.log(`[demo] starting the studio on http://127.0.0.1:${APP_PORT}`);
}

let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  next?.kill("SIGTERM");
  proxy.close();
  await mock.close();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
