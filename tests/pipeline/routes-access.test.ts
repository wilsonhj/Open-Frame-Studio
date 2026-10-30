/**
 * The pipeline routes follow the /api/jobs access policy (lib/access.ts):
 * billed writes need the studio access code, reads use the run id as the
 * capability, and step files get the same safe headers as job outputs.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import type { AnyPipelineDefinition } from "../../lib/pipeline/types.ts";

const env = process.env as Record<string, string | undefined>;
let dir: string;
let runner: typeof import("../../lib/pipeline/runner.ts");
let access: typeof import("../../lib/access.ts");
let create: typeof import("../../app/api/pipelines/[kind]/route.ts");
let actions: typeof import("../../app/api/pipelines/[kind]/[runId]/[...action]/route.ts");
let files: typeof import("../../app/api/pipelines/[kind]/[runId]/files/[stepId]/[name]/route.ts");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "oss-routes-"));
  env.COMFY_BASE_URL = "http://comfy.test";
  env.COMFY_API_KEY = "test-key";
  env.DATA_DIR = dir;
  env.HANDLE_SECRET = "test-secret";
  runner = await import("../../lib/pipeline/runner.ts");
  access = await import("../../lib/access.ts");
  create = await import("../../app/api/pipelines/[kind]/route.ts");
  actions = await import("../../app/api/pipelines/[kind]/[runId]/[...action]/route.ts");
  files = await import("../../app/api/pipelines/[kind]/[runId]/files/[stepId]/[name]/route.ts");
  runner.registerDefinition({
    kind: "motion",
    validate: (raw: unknown) =>
      raw && typeof raw === "object" && "ok" in raw ? { ok: true, value: raw } : { ok: false, error: "bad", field: "ok" },
    plan: async () => [{ id: "note", kind: "code", workflow: "note", dependsOn: [], inputs: {}, timeoutMs: 5_000, status: "pending" }],
    handlers: {
      note: async () => ({ files: [{ name: "page.html", contentType: "text/html", bytes: new TextEncoder().encode("<script>x</script>") }] }),
    },
    buildResult: async () => null,
    actions: { retry: { method: "POST", path: "retry", run: async () => ({ type: "error", status: 409, error: "busy" }) } },
  } as unknown as AnyPipelineDefinition);
  // A kind whose plan holds `jobs` Comfy steps (never submitted here: every
  // test refuses them at the charge) and whose `more` action adds two.
  const comfy = (id: string) => ({ id, kind: "comfy", workflow: "cutout", dependsOn: [], inputs: {}, timeoutMs: 5_000, status: "pending" });
  const note = { id: "note", kind: "code", workflow: "note", dependsOn: [], inputs: {}, timeoutMs: 5_000, status: "pending" };
  runner.registerDefinition({
    kind: "photoshoot",
    validate: (raw: unknown) => ({ ok: true, value: raw }),
    plan: async (r: { jobs?: number }) => [note, ...Array.from({ length: r.jobs ?? 0 }, (_, k) => comfy(`job_${k}`))],
    handlers: { note: async () => ({}) },
    buildResult: async () => null,
    actions: {
      more: { method: "POST", path: "more", run: async (ctx: { run: { steps: unknown[] } }) => ({ type: "replan", steps: [...ctx.run.steps, comfy("extra_1"), comfy("extra_2")] }) },
    },
  } as unknown as AnyPipelineDefinition);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  access.resetRateLimits();
  access.resetCredentialFailures();
  delete env.STUDIO_ACCESS_CODE;
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const kindParams = (kind: string) => ({ params: Promise.resolve({ kind }) });
const actionParams = (runId: string, action: string[]) => ({ params: Promise.resolve({ kind: "motion", runId, action }) });

describe("pipeline routes: access policy", () => {
  it("creating a run needs the access code when one is set", async () => {
    env.STUDIO_ACCESS_CODE = "open-sesame-123";
    const denied = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, "access_code_required");

    const allowed = await create.POST(
      post("http://localhost/api/pipelines/motion", { ok: true }, { "x-access-code": "open-sesame-123" }),
      kindParams("motion"),
    );
    assert.equal(allowed.status, 202);
    await runner.whenIdle((await allowed.json()).id);
  });

  it("billed and cancel actions need the code; refused actions are not 401", async () => {
    const created = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
    const run = await created.json();
    await runner.whenIdle(run.id);
    env.STUDIO_ACCESS_CODE = "open-sesame-123";
    for (const action of [["retry"], ["cancel"]]) {
      const res = await actions.POST(post(`http://localhost/x`, {}), actionParams(run.id, action));
      assert.equal(res.status, 401, action.join("/"));
    }
    const ok = await actions.POST(post(`http://localhost/x`, {}, { "x-access-code": "open-sesame-123" }), actionParams(run.id, ["retry"]));
    assert.equal(ok.status, 409);
  });

  it("serves a non-media step file as a sandboxed download", async () => {
    const created = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
    const run = await created.json();
    await runner.whenIdle(run.id);
    const res = await files.GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ kind: "motion", runId: run.id, stepId: "note", name: "page.html" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment/);
    assert.match(res.headers.get("content-security-policy") ?? "", /sandbox/);
  });

  it("cancel still works for a caller whose last submit slot is spent", async () => {
    env.SUBMITS_PER_HOUR = "1";
    try {
      const created = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
      assert.equal(created.status, 202);
      const run = await created.json();
      await runner.whenIdle(run.id);
      const again = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
      assert.equal(again.status, 429);
      const cancel = await actions.POST(post("http://localhost/x", {}), actionParams(run.id, ["cancel"]));
      assert.equal(cancel.status, 200);
    } finally {
      delete env.SUBMITS_PER_HOUR;
    }
  });

  it("a run takes one submit slot per planned Comfy job, and a refused run takes none", async () => {
    env.SUBMITS_PER_HOUR = "4";
    try {
      const big = await create.POST(post("http://localhost/api/pipelines/photoshoot", { jobs: 5 }), kindParams("photoshoot"));
      assert.equal(big.status, 429);
      assert.equal((await big.json()).code, "rate_limited");
      assert.ok(big.headers.get("retry-after"));
      // The refused run gave every slot back: four one-slot runs still fit.
      for (let i = 0; i < 4; i++) {
        const ok = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
        assert.equal(ok.status, 202, `run ${i + 1}`);
        await runner.whenIdle((await ok.json()).id);
      }
      const full = await create.POST(post("http://localhost/api/pipelines/motion", { ok: true }), kindParams("motion"));
      assert.equal(full.status, 429);
    } finally {
      delete env.SUBMITS_PER_HOUR;
    }
  });

  it("charges createRun and replans for the Comfy jobs they would submit", async () => {
    const charged: number[] = [];
    const refuse = (jobs: number) => {
      charged.push(jobs);
      throw new access.AccessError(429, "rate_limited", "Too many jobs", 60);
    };
    const created = await runner.createRun("photoshoot", { jobs: 3 }, new Map(), refuse);
    assert.deepEqual(created, { ok: false, status: 429, error: "Too many jobs", code: "rate_limited", retryAfterSeconds: 60 });
    // A code-only run is charged nothing extra and runs.
    const free = await runner.createRun("photoshoot", { jobs: 0 }, new Map(), (jobs) => (charged.push(jobs), () => {}));
    assert.ok(free.ok);
    await runner.whenIdle(free.run.id);
    const more = await runner.runAction("photoshoot", free.run.id, "POST", ["more"], null, refuse);
    assert.equal(more.type, "error");
    assert.equal(more.type === "error" && more.status, 429);
    assert.deepEqual(charged, [3, 0, 2]);
    // Refused before the merge: the run is unchanged.
    assert.deepEqual((await runner.getRun(free.run.id))?.steps.map((st) => st.id), ["note"]);
  });

  it("rejects mislabelled and oversized uploads before any asset is created", async () => {
    const send = (bytes: Uint8Array, type: string) => {
      const form = new FormData();
      form.set("request", JSON.stringify({ ok: true, image: { upload: "product" } }));
      form.set("product", new File([bytes as Uint8Array<ArrayBuffer>], "p.png", { type }));
      return create.POST(new Request("http://localhost/api/pipelines/motion", { method: "POST", body: form }), kindParams("motion"));
    };
    const html = await send(new TextEncoder().encode("<html><script>x</script></html>"), "image/png");
    assert.equal(html.status, 400);
    assert.equal((await html.json()).field, "product");
    const big = new Uint8Array(21 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversized = await send(big, "image/png");
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /20 MB/);
  });

  it("checks the access code and the size cap before reading the body", async () => {
    let pulled = false;
    const body = () =>
      new ReadableStream(
        {
          pull() {
            pulled = true;
            throw new Error("the body must not be read");
          },
        },
        { highWaterMark: 0 },
      );
    const request = (headers: Record<string, string>) =>
      new Request("http://localhost/api/pipelines/motion", {
        method: "POST",
        body: body(),
        headers: { "content-type": "multipart/form-data; boundary=x", ...headers },
        duplex: "half",
      } as RequestInit);

    env.STUDIO_ACCESS_CODE = "open-sesame-123";
    const denied = await create.POST(request({}), kindParams("motion"));
    assert.equal(denied.status, 401);
    assert.equal(pulled, false, "an unauthorised body is never read");

    const huge = await create.POST(
      request({ "x-access-code": "open-sesame-123", "content-length": String(create.MAX_BODY_BYTES + 1) }),
      kindParams("motion"),
    );
    assert.equal(huge.status, 413);
    assert.equal(pulled, false, "an oversized body is never read");
  });
});
