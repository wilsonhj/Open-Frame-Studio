/**
 * /api/souls routes: faces need the access code (like the list), uploads are
 * bounded before they are buffered, and likeness consent is required for
 * imports and recorded for previews. Synthetic photos only.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { noisePhoto, oneFace } from "./helpers.ts";

const env = process.env as Record<string, string | undefined>;
const CODE = "open-sesame-123";
let dir: string;
let id = "";
let registry: typeof import("../../lib/soul/registry.ts");
let access: typeof import("../../lib/access.ts");
let list: typeof import("../../app/api/souls/route.ts");
let one: typeof import("../../app/api/souls/[id]/route.ts");
let exporter: typeof import("../../app/api/souls/[id]/export/route.ts");
let refs: typeof import("../../app/api/souls/[id]/refs/[n]/route.ts");
let importer: typeof import("../../app/api/souls/import/route.ts");
let preview: typeof import("../../app/api/souls/[id]/preview/route.ts");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "oss-souls-routes-"));
  env.COMFY_BASE_URL = "http://comfy.test";
  env.COMFY_API_KEY = "test-key";
  env.DATA_DIR = dir;
  env.HANDLE_SECRET = "test-secret";
  registry = await import("../../lib/soul/registry.ts");
  access = await import("../../lib/access.ts");
  list = await import("../../app/api/souls/route.ts");
  one = await import("../../app/api/souls/[id]/route.ts");
  exporter = await import("../../app/api/souls/[id]/export/route.ts");
  refs = await import("../../app/api/souls/[id]/refs/[n]/route.ts");
  importer = await import("../../app/api/souls/import/route.ts");
  preview = await import("../../app/api/souls/[id]/preview/route.ts");
  const { checkPhoto } = await import("../../lib/identity/qa.ts");
  const candidates = [];
  for (let i = 0; i < 3; i++) candidates.push(await checkPhoto(await noisePhoto(1200, 1500, { seedShift: i * 9 - 20 }), i, { detect: oneFace }));
  id = (await registry.createIdentity({ name: "Maya", consent: "true", refs: candidates as never })).id;
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  access.resetRateLimits();
  delete env.STUDIO_ACCESS_CODE;
});

const get = (path: string, code?: string) => new Request(`http://localhost${path}`, { headers: code ? { "x-access-code": code } : {} });
const idParams = () => ({ params: Promise.resolve({ id }) });

/** A multipart request with the Content-Length a browser sends (or none). */
async function multipart(path: string, form: FormData, { length = true } = {}): Promise<Request> {
  const draft = new Request(`http://localhost${path}`, { method: "POST", body: form });
  const body = new Uint8Array(await draft.arrayBuffer());
  const headers: Record<string, string> = { "content-type": draft.headers.get("content-type")! };
  if (length) headers["content-length"] = String(body.byteLength);
  return new Request(`http://localhost${path}`, { method: "POST", body, headers });
}

describe("souls routes: faces need the access code", () => {
  it("GET one, export and ref thumbnails are 401 without the code, like the list", async () => {
    env.STUDIO_ACCESS_CODE = CODE;
    const calls = [
      (code?: string) => list.GET(get("/api/souls", code)),
      (code?: string) => one.GET(get(`/api/souls/${id}`, code), idParams()),
      (code?: string) => exporter.GET(get(`/api/souls/${id}/export`, code), idParams()),
      (code?: string) => refs.GET(get(`/api/souls/${id}/refs/0`, code), { params: Promise.resolve({ id, n: "0" }) }),
    ];
    for (const call of calls) {
      const denied = await call();
      assert.equal(denied.status, 401);
      assert.equal((await denied.json()).code, "access_code_required");
      assert.equal((await call(CODE)).status, 200);
    }
  });
});

describe("souls routes: uploads", () => {
  it("refuses a create or import without a Content-Length before reading it", async () => {
    const form = new FormData();
    form.set("consent", "true");
    form.set("name", "x");
    assert.equal((await list.POST(await multipart("/api/souls", form, { length: false }))).status, 411);
    assert.equal((await importer.POST(await multipart("/api/souls/import", form, { length: false }))).status, 411);
  });

  it("checks consent before any photo is read", async () => {
    const form = new FormData();
    form.set("name", "x");
    form.append("photos", new File([new Uint8Array(26 * 1024 * 1024)], "big.jpg"));
    const response = await list.POST(await multipart("/api/souls", form));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).field, "consent");
    form.set("consent", "true");
    assert.equal((await list.POST(await multipart("/api/souls", form))).status, 413, "per-photo cap on file.size");
  });

  it("import needs likeness consent", async () => {
    const { bytes } = await registry.exportBundle(id);
    const form = new FormData();
    form.set("bundle", new File([bytes as Uint8Array<ArrayBuffer>], "maya.identity.zip"));
    const refused = await importer.POST(await multipart("/api/souls/import", form));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).field, "consent");
  });
});

describe("souls routes: preview needs a consent record", () => {
  it("refuses an identity saved without consentedAt, before any job", async () => {
    const file = join(dir, "identities", id, "identity.json");
    const doc = JSON.parse(await readFile(file, "utf-8"));
    delete doc.consentedAt;
    await writeFile(file, JSON.stringify(doc));
    const response = await preview.POST(new Request(`http://localhost/api/souls/${id}/preview`, { method: "POST" }), idParams());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).field, "consent");
  });
});
