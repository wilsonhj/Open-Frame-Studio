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
 *   POST /__mock/scenario {"scenario": ...} (control endpoint for manual runs)
 *
 * Scenarios: succeeded | failed | unknown_forever | expired | reject_idempotency.
 *
 * Run standalone: `pnpm mock-comfy` (PORT=8189), then COMFY_BASE_URL=http://127.0.0.1:8189 pnpm dev.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Scenario = "succeeded" | "failed" | "unknown_forever" | "expired" | "reject_idempotency";

export const SCENARIOS: readonly Scenario[] = [
  "succeeded",
  "failed",
  "unknown_forever",
  "expired",
  "reject_idempotency",
];

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

type StoredAsset = { id: string; hash: string | null; bytes: Buffer; contentType: string; filePath: string; jobId?: string };

type MockJob = {
  id: string;
  scenario: Scenario;
  polls: number;
  canceled?: boolean;
  workflow: Record<string, unknown>;
  body: Record<string, unknown>;
  createdAt: string;
};

export type MockState = {
  scenario: Scenario;
  /** "proxy": content served inline; "cloud": content 302-redirects to a signed URL. */
  /** "relative": a proxy that 302s to a path-relative Location on its own origin. */
  contentMode: "proxy" | "cloud" | "relative";
  assets: Map<string, StoredAsset>;
  jobs: Map<string, MockJob>;
  idempotencyKeys: Set<string>;
  /** Every POST /api/v2/jobs request received (including rejected ones). */
  jobPosts: Array<{ idempotencyKey: string | null; body: Record<string, unknown> }>;
  assetPosts: number;
  authHeaders: Array<string | null>;
  /** Requests to the fake storage host; a bearer token must never appear here. */
  signedFetches: Array<{ authorization: string | null }>;
  /** Job ids that received POST /api/v2/jobs/{id}/cancel. */
  cancels: string[];
};

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
const PROGRESSIONS: Record<Exclude<Scenario, "reject_idempotency">, string[]> = {
  succeeded: ["queued", "running", "succeeded"],
  failed: ["queued", "running", "failed"],
  unknown_forever: ["unknown"],
  expired: ["queued", "expired"],
};

export function startMockComfy(options: { port?: number; scenario?: Scenario } = {}): Promise<MockComfy> {
  const state: MockState = {
    scenario: options.scenario ?? "succeeded",
    contentMode: "proxy",
    assets: new Map(),
    jobs: new Map(),
    idempotencyKeys: new Set(),
    jobPosts: [],
    assetPosts: 0,
    authHeaders: [],
    signedFetches: [],
    cancels: [],
  };
  let base = "";

  function jobJson(job: MockJob, advance: boolean) {
    if (advance) job.polls += 1;
    const seq = PROGRESSIONS[job.scenario as keyof typeof PROGRESSIONS] ?? ["unknown"];
    const status = job.canceled ? "canceled" : seq[Math.min(job.polls, seq.length - 1)];
    let outputs: unknown[] = [];
    if (status === "succeeded") {
      const outId = `out-${job.id}`;
      if (!state.assets.has(outId)) {
        state.assets.set(outId, {
          id: outId,
          hash: null,
          bytes: PNG_1X1,
          contentType: "image/png",
          filePath: "open-soul-studio/smoke_00001_.png",
          jobId: job.id,
        });
      }
      const asset = state.assets.get(outId)!;
      outputs = [
        {
          node_id: "3",
          name: "smoke_00001_.png",
          type: "image",
          content_type: "image/png",
          size_bytes: asset.bytes.length,
          id: outId,
          hash: null,
          url: `${base}/api/v2/assets/${outId}/content`,
          url_expires_at: FUTURE(),
          job_id: job.id,
        },
      ];
    }
    const terminal = ["succeeded", "failed", "canceled", "expired"].includes(status);
    return {
      id: job.id,
      status,
      created_at: job.createdAt,
      started_at: status === "queued" ? null : job.createdAt,
      completed_at: terminal ? new Date().toISOString() : null,
      expires_at: FUTURE(),
      queue_position: status === "queued" ? 1 : null,
      progress: status === "running" ? { value: 0.5, nodes_done: 1, nodes_total: 2 } : null,
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

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (path.startsWith("/api/v2/")) state.authHeaders.push(req.headers.authorization ?? null);

    if (method === "POST" && path === "/__mock/scenario") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { scenario?: Scenario; contentMode?: MockState["contentMode"] };
      if (body.scenario && SCENARIOS.includes(body.scenario)) state.scenario = body.scenario;
      if (body.contentMode) state.contentMode = body.contentMode;
      return send(res, 200, { scenario: state.scenario, contentMode: state.contentMode });
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
      const asset = state.assets.get(decodeURIComponent(m[1]));
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
      const asset = state.assets.get(decodeURIComponent(m[1]));
      return asset ? send(res, 200, assetJson(asset, base)) : send(res, 404, envelope("asset_not_found", "No such asset."));
    }
    if (method === "POST" && path === "/api/v2/jobs") {
      const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
      const body = JSON.parse((await readBody(req)).toString()) as Record<string, unknown>;
      state.jobPosts.push({ idempotencyKey: key, body });
      if (state.scenario === "reject_idempotency" || (key && state.idempotencyKeys.has(key))) {
        return send(res, 422, envelope("idempotency_key_reuse", "Idempotency-Key was already used."));
      }
      if (key) state.idempotencyKeys.add(key);
      const workflow = body.workflow as Record<string, unknown> | undefined;
      if (!workflow || typeof workflow !== "object") return send(res, 422, envelope("invalid_workflow", "workflow is required"));
      if ("nodes" in workflow && "links" in workflow) {
        return send(res, 422, envelope("workflow_format_ui", "Submit the API-format graph."));
      }
      const job: MockJob = {
        id: randomUUID(),
        scenario: state.scenario,
        polls: 0,
        workflow,
        body,
        createdAt: new Date().toISOString(),
      };
      state.jobs.set(job.id, job);
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
      // Like the real API: a job that already finished stays finished.
      const current = jobJson(job, false).status;
      if (!["succeeded", "failed", "canceled", "expired"].includes(current)) job.canceled = true;
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
  startMockComfy({ port }).then((mock) => {
    console.log(`mock Comfy API v2 listening on ${mock.url} (scenario: ${mock.state.scenario})`);
  });
}
