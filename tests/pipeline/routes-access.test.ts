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
