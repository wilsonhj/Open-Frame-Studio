/**
 * Mock Comfy API v2 server for offline tests and local UI work.
 *
 * Implements the subset @comfyorg/sdk 0.5.0 uses:
 *   HEAD /api/v2/assets/by-hash/:hash      (dedup probe; 404 unless known)
 *   POST /api/v2/assets/from-hash
 *   POST /api/v2/assets                    (multipart upload)
 *   GET  /api/v2/assets/:id
 *   GET  /api/v2/assets/:id/content        (inline bytes, or 302 to /signed/:id in "cloud" mode)
 *   POST /api/v2/jobs                      (scripted scenarios, idempotency-key tracking)
 *   GET  /api/v2/jobs/:id                  (advances the scenario one step per poll)
 *   POST /__mock/scenario {"scenario": ..., "contentMode"?: ..., "queuedMs"?: n, "missingAssetIds"?: [...]} (control endpoint)
 *   GET  /__mock/health                    (readiness probe for Playwright's webServer)
 *   GET  /__mock/requests                  (recorded job POSTs, each with the asset ids it used, + asset upload count)
 *   POST /__mock/reset                     (defaults: succeeded/proxy/20 s; clears recorded requests and missingAssetIds)
 *
 * Scenarios:
 *   succeeded          queued -> running -> succeeded, one PNG output
 *   failed             queued -> running -> failed (execution_error)
 *   unknown_forever    always "unknown"
 *   expired            queued -> expired
 *   reject_idempotency every POST /api/v2/jobs is refused with idempotency_key_reuse
 *   multi_output       like succeeded, but outputs 2 PNGs (node "9") + 1 MP4 (node "12")
 *                      (Motion / photoshoot batches that mix images and a clip)
 *   slow_progress      queued, then SLOW_PROGRESS_POLLS running polls with rising
 *                      progress.value and nodes_done, then succeeded (progress-bar UI)
 *   queued_20s         wall-clock: "queued" (queue_position counting down) until
 *                      state.queuedMs (default 20000) has elapsed since submit, then one
 *                      "running" poll, then succeeded ("still queued" UX, cold starts)
 *   asset_missing      like succeeded, but every asset id in state.missingAssetIds is gone:
 *                      GET /api/v2/assets/{id} (and /content) answer 404 asset_not_found, and a
 *                      job POST that references one is refused with 422 asset_not_found
 *                      (stale asset cache; Identity reuse test S-R1 step 7)
 *   drop_after_create  records the Idempotency-Key, creates the job (like succeeded), then
 *                      destroys the socket without responding (ambiguous submit). A same-key
 *                      re-send then gets 422 idempotency_key_reuse.
 *
 * Run standalone: `pnpm mock-comfy` (PORT=8189), then COMFY_BASE_URL=http://127.0.0.1:8189 pnpm dev.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Scenario =
  | "succeeded"
  | "failed"
  | "unknown_forever"
  | "expired"
  | "reject_idempotency"
  | "multi_output"
  | "slow_progress"
  | "queued_20s"
  | "asset_missing"
  | "drop_after_create";

export const SCENARIOS: readonly Scenario[] = [
  "succeeded",
  "failed",
  "unknown_forever",
  "expired",
  "reject_idempotency",
  "multi_output",
  "slow_progress",
  "queued_20s",
  "asset_missing",
  "drop_after_create",
];

/** Running polls in the slow_progress scenario before it succeeds. */
export const SLOW_PROGRESS_POLLS = 10;

/** Default time a queued_20s job stays queued. */
export const DEFAULT_QUEUED_MS = 20_000;

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Placeholder bytes for a video output: a lone ISO-BMFF `ftyp` box (brand isom).
 * Enough for content-type / download plumbing; not a playable clip.
 */
export const MP4_STUB = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f,
  0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

type StoredAsset = { id: string; hash: string | null; bytes: Buffer; contentType: string; filePath: string; jobId?: string };

type MockJob = {
  id: string;
  scenario: Scenario;
  polls: number;
  /** Date.now() at submit; drives the wall-clock queued_20s scenario. */
  createdMs: number;
  /** Set by POST /api/v2/jobs/{id}/cancel while the job was still live. */
  canceled?: boolean;
  /** Poll index at which a queued_20s job left the queue. */
  leftQueueAtPoll?: number;
  workflow: Record<string, unknown>;
  body: Record<string, unknown>;
  createdAt: string;
};

export type MockState = {
  scenario: Scenario;
  /** "proxy": content served inline; "cloud": content 302-redirects to a signed URL. */
  /** "relative": a proxy that 302s to a path-relative Location on its own origin. */
  contentMode: "proxy" | "cloud" | "relative";
  /** How long a queued_20s job stays queued (ms). Tests may shorten it. */
  queuedMs: number;
  assets: Map<string, StoredAsset>;
  jobs: Map<string, MockJob>;
  idempotencyKeys: Set<string>;
  /** Every POST /api/v2/jobs request received (including rejected ones). */
  jobPosts: JobPost[];
  /** Asset ids that answer 404 while the scenario is `asset_missing`. */
  missingAssetIds: Set<string>;
  assetPosts: number;
  authHeaders: Array<string | null>;
  /** Requests to the fake storage host; a bearer token must never appear here. */
  signedFetches: Array<{ authorization: string | null }>;
  /** Job ids that received POST /api/v2/jobs/{id}/cancel. */
  cancels: string[];
  /** "ok": cancel takes effect; "pending": reports `canceling`, job keeps running; "error": 503. */
  cancelBehavior: "ok" | "pending" | "error";
};

export type JobPost = {
  idempotencyKey: string | null;
  body: Record<string, unknown>;
  /** `core/ASSET` ids referenced by the submitted workflow, in graph order. */
  assetIds: string[];
  /** Id of the job this POST created (null if it was refused). */
  jobId: string | null;
};

/** Collect the ids of every `core/ASSET` reference in a workflow graph. */
export function assetIdsIn(graph: unknown): string[] {
  if (Array.isArray(graph)) return graph.flatMap(assetIdsIn);
  if (graph === null || typeof graph !== "object") return [];
  const record = graph as Record<string, unknown>;
  if (record.__type === "core/ASSET") {
    const id = (record.info as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? [id] : [];
  }
  return Object.values(record).flatMap(assetIdsIn);
}

export type MockComfy = {
  url: string;
  state: MockState;
  setScenario(scenario: Scenario): void;
  close(): Promise<void>;
};

const FUTURE = () => new Date(Date.now() + 6 * 3600_000).toISOString();

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function envelope(code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, details: details ?? null } };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function assetJson(asset: StoredAsset, base: string) {
  return {
    id: asset.id,
    hash: asset.hash,
    size_bytes: asset.bytes.length,
    content_type: asset.contentType,
    file_path: asset.filePath,
    created_new: true,
    created_at: new Date().toISOString(),
    url: `${base}/api/v2/assets/${asset.id}/content`,
    url_expires_at: FUTURE(),
    expires_at: null,
    job_id: asset.jobId ?? null,
  };
}

/** Status sequence per scenario, indexed by poll count (last entry repeats). */
const PROGRESSIONS: Record<"succeeded" | "failed" | "unknown_forever" | "expired", string[]> = {
  succeeded: ["queued", "running", "succeeded"],
  failed: ["queued", "running", "failed"],
  unknown_forever: ["unknown"],
  expired: ["queued", "expired"],
};

export function startMockComfy(options: { port?: number; scenario?: Scenario } = {}): Promise<MockComfy> {
  const state: MockState = {
    scenario: options.scenario ?? "succeeded",
    contentMode: "proxy",
    queuedMs: DEFAULT_QUEUED_MS,
    assets: new Map(),
    jobs: new Map(),
    idempotencyKeys: new Set(),
    jobPosts: [],
    missingAssetIds: new Set(),
    assetPosts: 0,
    authHeaders: [],
    signedFetches: [],
    cancels: [],
    cancelBehavior: "ok",
  };
  let base = "";

  type Phase = { status: string; progress: { value: number; nodes_done: number; nodes_total: number } | null; queuePosition: number | null };

  function phaseOf(job: MockJob): Phase {
    const queued = (queuePosition = 1): Phase => ({ status: "queued", progress: null, queuePosition });
    const running = (value = 0.5, nodesDone = 1, nodesTotal = 2): Phase => ({
      status: "running",
      progress: { value, nodes_done: nodesDone, nodes_total: nodesTotal },
      queuePosition: null,
    });
    const done = (status: string): Phase => ({ status, progress: null, queuePosition: null });

    switch (job.scenario) {
      case "slow_progress": {
        if (job.polls === 0) return queued();
        if (job.polls <= SLOW_PROGRESS_POLLS) {
          const doneNodes = job.polls - 1;
          return running(doneNodes / SLOW_PROGRESS_POLLS, doneNodes, SLOW_PROGRESS_POLLS);
        }
        return done("succeeded");
      }
      case "queued_20s": {
        const remaining = state.queuedMs - (Date.now() - job.createdMs);
        if (remaining > 0 && job.leftQueueAtPoll === undefined) {
          return queued(Math.max(1, Math.ceil(remaining / 5_000)));
        }
        job.leftQueueAtPoll ??= job.polls;
        return job.polls === job.leftQueueAtPoll ? running() : done("succeeded");
      }
      case "multi_output":
      default: {
        const key = ["multi_output", "asset_missing", "drop_after_create"].includes(job.scenario) ? "succeeded" : job.scenario;
        const seq = PROGRESSIONS[key as keyof typeof PROGRESSIONS] ?? ["unknown"];
        const status = seq[Math.min(job.polls, seq.length - 1)];
        if (status === "queued") return queued();
        if (status === "running") return running();
        return done(status);
      }
    }
  }

  function storeOutput(job: MockJob, suffix: string, bytes: Buffer, contentType: string, filePath: string): StoredAsset {
    const outId = `out-${job.id}${suffix}`;
    if (!state.assets.has(outId)) {
      state.assets.set(outId, { id: outId, hash: null, bytes, contentType, filePath, jobId: job.id });
    }
    return state.assets.get(outId)!;
  }

  function outputJson(job: MockJob, asset: StoredAsset, nodeId: string, type: string) {
    return {
      node_id: nodeId,
      name: asset.filePath.split("/").pop(),
      type,
      content_type: asset.contentType,
      size_bytes: asset.bytes.length,
      id: asset.id,
      hash: null,
      url: `${base}/api/v2/assets/${asset.id}/content`,
      url_expires_at: FUTURE(),
      job_id: job.id,
    };
  }

  function outputsOf(job: MockJob): unknown[] {
    if (job.scenario === "multi_output") {
      return [
        outputJson(job, storeOutput(job, "-img-1", PNG_1X1, "image/png", "open-frame-studio/multi_00001_.png"), "9", "image"),
        outputJson(job, storeOutput(job, "-img-2", PNG_1X1, "image/png", "open-frame-studio/multi_00002_.png"), "9", "image"),
        outputJson(job, storeOutput(job, "-vid-1", MP4_STUB, "video/mp4", "open-frame-studio/multi_00001_.mp4"), "12", "video"),
      ];
    }
    // Keep the original id (`out-<jobId>`) so existing tests and clients stay stable.
    return [outputJson(job, storeOutput(job, "", PNG_1X1, "image/png", "open-frame-studio/smoke_00001_.png"), "3", "image")];
  }

  function jobJson(job: MockJob, advance: boolean) {
    if (advance) job.polls += 1;
    const phase: Phase = job.canceled ? { status: "canceled", progress: null, queuePosition: null } : phaseOf(job);
    const status = phase.status;
    const outputs: unknown[] = status === "succeeded" ? outputsOf(job) : [];
    const terminal = ["succeeded", "failed", "canceled", "expired"].includes(status);
    return {
      id: job.id,
      status,
      created_at: job.createdAt,
      started_at: status === "queued" ? null : job.createdAt,
      completed_at: terminal ? new Date().toISOString() : null,
      expires_at: FUTURE(),
      queue_position: phase.queuePosition,
      progress: phase.progress,
      outputs,
      error:
        status === "failed"
          ? { code: "execution_error", message: "Mock node exploded.", node_id: "2", class_type: "ImageScaleBy" }
          : null,
      metrics: {},
      urls: {
        self: `/api/v2/jobs/${job.id}`,
        events: `/api/v2/jobs/${job.id}/events`,
        cancel: `/api/v2/jobs/${job.id}/cancel`,
      },
    };
  }

  function isMissing(assetId: string): boolean {
    return state.scenario === "asset_missing" && state.missingAssetIds.has(assetId);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (path.startsWith("/api/v2/")) state.authHeaders.push(req.headers.authorization ?? null);

    if (method === "POST" && path === "/__mock/scenario") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as {
        scenario?: Scenario;
        contentMode?: MockState["contentMode"];
        queuedMs?: number;
        missingAssetIds?: unknown;
      };
      if (body.scenario && !SCENARIOS.includes(body.scenario)) {
        return send(res, 422, envelope("unknown_scenario", `Unknown scenario ${JSON.stringify(body.scenario)}.`, { scenarios: SCENARIOS }));
      }
      if (body.scenario) state.scenario = body.scenario;
      if (body.contentMode) state.contentMode = body.contentMode;
      if (typeof body.queuedMs === "number" && Number.isFinite(body.queuedMs) && body.queuedMs >= 0) state.queuedMs = body.queuedMs;
      if (Array.isArray(body.missingAssetIds)) {
        state.missingAssetIds = new Set(body.missingAssetIds.filter((id): id is string => typeof id === "string"));
      }
      return send(res, 200, {
        scenario: state.scenario,
        contentMode: state.contentMode,
        queuedMs: state.queuedMs,
        missingAssetIds: [...state.missingAssetIds],
      });
    }
    if (method === "GET" && path === "/__mock/health") {
      return send(res, 200, { ok: true, scenario: state.scenario, scenarios: SCENARIOS });
    }
    if (method === "GET" && path === "/__mock/requests") {
      return send(res, 200, { assetPosts: state.assetPosts, jobPosts: state.jobPosts });
    }
    if (method === "POST" && path === "/__mock/reset") {
      state.scenario = "succeeded";
      state.contentMode = "proxy";
      state.queuedMs = DEFAULT_QUEUED_MS;
      state.jobPosts.length = 0;
      state.missingAssetIds.clear();
      state.assetPosts = 0;
      state.signedFetches.length = 0;
      state.cancels.length = 0;
      state.cancelBehavior = "ok";
      return send(res, 200, { scenario: state.scenario, contentMode: state.contentMode, queuedMs: state.queuedMs });
    }

    let m: RegExpMatchArray | null;
    if (method === "HEAD" && (m = path.match(/^\/api\/v2\/assets\/by-hash\/(.+)$/))) {
      const hash = decodeURIComponent(m[1]);
      const known = [...state.assets.values()].some((a) => a.hash === hash);
      return send(res, known ? 200 : 404);
    }
    if (method === "POST" && path === "/api/v2/assets/from-hash") {
      const body = JSON.parse((await readBody(req)).toString()) as { hash: string; file_path?: string };
      const existing = [...state.assets.values()].find((a) => a.hash === body.hash);
      if (!existing) return send(res, 404, envelope("blob_not_found", "No blob with that hash."));
      const asset = { ...existing, id: randomUUID(), filePath: body.file_path ?? existing.filePath };
      state.assets.set(asset.id, asset);
      return send(res, 201, assetJson(asset, base));
    }
    if (method === "POST" && path === "/api/v2/assets") {
      state.assetPosts += 1;
      const raw = await readBody(req);
      const form = await new Response(new Uint8Array(raw), { headers: { "Content-Type": req.headers["content-type"] ?? "" } }).formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return send(res, 422, envelope("invalid_request", "file is required"));
      const bytes = Buffer.from(await file.arrayBuffer());
      const asset: StoredAsset = {
        id: randomUUID(),
        hash: (form.get("expected_hash") as string | null) ?? null,
        bytes,
        contentType: String(form.get("content_type") ?? "application/octet-stream"),
        filePath: String(form.get("file_path") ?? "upload.bin"),
      };
      state.assets.set(asset.id, asset);
      return send(res, 201, assetJson(asset, base));
    }
    if (method === "GET" && (m = path.match(/^\/api\/v2\/assets\/([^/]+)\/content$/))) {
      const asset = isMissing(decodeURIComponent(m[1])) ? undefined : state.assets.get(decodeURIComponent(m[1]));
      if (!asset) return send(res, 404, envelope("asset_not_found", "No such asset."));
      if (state.contentMode === "relative" && !url.searchParams.has("raw")) {
        return send(res, 302, undefined, { Location: `/api/v2/assets/${asset.id}/content?raw=1` });
      }
      if (state.contentMode === "cloud") {
        // A different origin (localhost vs 127.0.0.1) stands in for the storage host.
        const signedBase = base.replace("127.0.0.1", "localhost");
        const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        return send(res, 302, undefined, {
          Location: `${signedBase}/signed/${asset.id}?X-Goog-Date=${date}&X-Goog-Expires=3600`,
        });
      }
      res.writeHead(200, { "Content-Type": asset.contentType, "Content-Length": asset.bytes.length });
      return res.end(asset.bytes);
    }
    if (method === "GET" && (m = path.match(/^\/signed\/([^/]+)$/))) {
      state.signedFetches.push({ authorization: req.headers.authorization ?? null });
      const asset = state.assets.get(decodeURIComponent(m[1]));
      if (!asset) return send(res, 404);
      res.writeHead(200, { "Content-Type": asset.contentType, "Content-Length": asset.bytes.length });
      return res.end(asset.bytes);
    }
    if (method === "GET" && (m = path.match(/^\/api\/v2\/assets\/([^/]+)$/))) {
      const asset = isMissing(decodeURIComponent(m[1])) ? undefined : state.assets.get(decodeURIComponent(m[1]));
      return asset ? send(res, 200, assetJson(asset, base)) : send(res, 404, envelope("asset_not_found", "No such asset."));
    }
    if (method === "POST" && path === "/api/v2/jobs") {
      const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
      const body = JSON.parse((await readBody(req)).toString()) as Record<string, unknown>;
      const post: JobPost = { idempotencyKey: key, body, assetIds: assetIdsIn(body.workflow), jobId: null };
      state.jobPosts.push(post);
      if (state.scenario === "reject_idempotency" || (key && state.idempotencyKeys.has(key))) {
        return send(res, 422, envelope("idempotency_key_reuse", "Idempotency-Key was already used."));
      }
      if (key) state.idempotencyKeys.add(key);
      const workflow = body.workflow as Record<string, unknown> | undefined;
      if (!workflow || typeof workflow !== "object") return send(res, 422, envelope("invalid_workflow", "workflow is required"));
      if ("nodes" in workflow && "links" in workflow) {
        return send(res, 422, envelope("workflow_format_ui", "Submit the API-format graph."));
      }
      const gone = post.assetIds.find(isMissing);
      if (gone) return send(res, 422, envelope("asset_not_found", `Asset ${gone} does not exist.`, { asset_id: gone }));
      const job: MockJob = {
        id: randomUUID(),
        scenario: state.scenario,
        polls: 0,
        createdMs: Date.now(),
        workflow,
        body,
        createdAt: new Date().toISOString(),
      };
      state.jobs.set(job.id, job);
      post.jobId = job.id;
      if (state.scenario === "drop_after_create") {
        // The job exists and the key is spent, but the client never hears back.
        req.socket.destroy();
        return;
      }
      return send(res, 201, jobJson(job, false));
    }
    if (method === "GET" && (m = path.match(/^\/api\/v2\/jobs\/([^/]+)$/))) {
      const job = state.jobs.get(decodeURIComponent(m[1]));
      if (!job) return send(res, 404, envelope("job_not_found", "No such job."));
      return send(res, 200, jobJson(job, true));
    }
    if (method === "POST" && (m = path.match(/^\/api\/v2\/jobs\/([^/]+)\/cancel$/))) {
      const job = state.jobs.get(decodeURIComponent(m[1]));
      if (!job) return send(res, 404, envelope("job_not_found", "No such job."));
      state.cancels.push(job.id);
      if (state.cancelBehavior === "error") return send(res, 503, envelope("unavailable", "Cancel is unavailable."));
      // Like the real API: a job that already finished stays finished, and a
      // live job may report `canceling` before it is actually canceled.
      const current = jobJson(job, false).status;
      if (["succeeded", "failed", "canceled", "expired"].includes(current)) return send(res, 200, jobJson(job, false));
      if (state.cancelBehavior === "pending") return send(res, 200, { ...jobJson(job, false), status: "canceling" });
      job.canceled = true;
      return send(res, 200, jobJson(job, false));
    }
    if (method === "GET" && path === "/api/v2/jobs") {
      return send(res, 501, envelope("not_implemented", "Job listing is not implemented."));
    }
    return send(res, 404, envelope("not_found", `No route for ${method} ${path}`));
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      send(res, 500, envelope("internal", error instanceof Error ? error.message : String(error)));
    });
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({
        url: base,
        state,
        setScenario(scenario) {
          state.scenario = scenario;
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8189);
  const initial = process.env.MOCK_SCENARIO as Scenario | undefined;
  startMockComfy({ port, scenario: initial && SCENARIOS.includes(initial) ? initial : undefined }).then((mock) => {
    console.log(`mock Comfy API v2 listening on ${mock.url} (scenario: ${mock.state.scenario})`);
  });
}
