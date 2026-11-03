/**
 * Product Shoot with and without an Identity, end to end on the offline mock
 * Comfy (issue #49, docs/spec/photoshoot.md §2, §7): `hands_on` and `on_model`
 * bind a selected Identity's best refs as images 2-4 after the product
 * cutout, run from the product alone when none is selected, and refuse an
 * Identity that can't be used. Synthetic ref images only.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import sharp from "sharp";

import { PNG_1X1, startMockComfy, type MockComfy } from "../mock-comfy/server.ts";
import type { PipelineRun } from "../../lib/pipeline/types.ts";
import { IDENTITY_SCHEMA } from "../../lib/types.ts";

let mock: MockComfy;
let dir: string;
let runner: typeof import("../../lib/pipeline/runner.ts");
let store: typeof import("../../lib/store.ts");
let registry: typeof import("../../lib/soul/registry.ts");
let identityId = "";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function refPng(shade: number): Promise<Uint8Array> {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: shade, g: 120, b: 200 - shade } } }).png().toBuffer();
  return new Uint8Array(png);
}

before(async () => {
  mock = await startMockComfy();
  dir = await mkdtemp(join(tmpdir(), "oss-photoshoot-identity-"));
  process.env.COMFY_BASE_URL = mock.url;
  process.env.COMFY_API_KEY = "test-key";
  process.env.DATA_DIR = dir;
  runner = await import("../../lib/pipeline/runner.ts");
  store = await import("../../lib/store.ts");
  registry = await import("../../lib/soul/registry.ts");
  const refs = await Promise.all(
    [10, 60, 110, 160].map(async (shade, i) => {
      const png = await refPng(shade);
      return { png, sha256: sha(png), phash: "0".repeat(15) + i, crop: { x: 0, y: 0, w: 64, h: 64 }, score: 0.9 - i / 10 };
    }),
  );
  identityId = (await registry.createIdentity({ name: "Maya", consent: "true", refs: refs as never })).id;
});

after(async () => {
  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mock.state.jobPosts.length = 0;
});

const uploads = () => new Map([["product", { bytes: new Uint8Array(PNG_1X1), filename: "p.png", contentType: "image/png" }]]);

async function shoot(request: Record<string, unknown>) {
  const created = await runner.createRun("photoshoot", { images: [{ upload: "product" }], count: 2, ...request }, uploads());
  assert.ok(created.ok, created.ok ? "" : created.error);
  await runner.whenIdle(created.run.id);
  return (await store.loadRun(created.run.id)) as PipelineRun<"photoshoot">;
}

/** The submitted Klein jobs (every job after the cutout) and their prompts. */
function kleinPosts() {
  const [, ...shots] = mock.state.jobPosts;
  return shots.map((post) => ({ assetIds: post.assetIds, prompt: JSON.stringify(post.body) }));
}

describe("photoshoot with an Identity", () => {
  for (const mode of ["hands_on", "on_model"] as const) {
    it(`${mode}: the Identity's best 3 refs follow the product cutout in every frame`, async () => {
      const run = await shoot({ mode, identityId });
      assert.equal(run.status, "succeeded");
      const refIds = (await registry.getSoul(identityId))!.refs.slice(0, 3).map((r) => r.assetId);
      assert.ok(refIds.every(Boolean), "refs were uploaded as assets");

      const shots = run.steps.filter((s) => s.id.startsWith("shot-"));
      for (const step of shots) {
        assert.deepEqual(step.inputs.image_1, { fromStep: "cutout", outputNode: "cutout" });
        assert.deepEqual([step.inputs.image_2, step.inputs.image_3, step.inputs.image_4], refIds);
      }
      const posts = kleinPosts();
      assert.equal(posts.length, 2);
      for (const post of posts) {
        // Image 1 is the cutout (its own asset), then the three refs in order.
        assert.equal(post.assetIds.length, 4);
        assert.deepEqual(post.assetIds.slice(1), refIds);
        assert.match(post.prompt, /the person from images 2-4/);
      }
      assert.equal(run.result?.notices.length, 0);
    });
  }

  it("packshot ignores the Identity, with a notice, and submits only the cutout", async () => {
    const run = await shoot({ mode: "packshot", identityId });
    assert.equal(run.status, "succeeded");
    assert.ok(run.result?.notices.some((n) => n.startsWith("Identity ignored")));
    for (const post of kleinPosts()) assert.equal(post.assetIds.length, 1);
  });
});

describe("photoshoot without an Identity", () => {
  it("hands_on runs from the product photo alone, with hands described in the prompt", async () => {
    const run = await shoot({ mode: "hands_on" });
    assert.equal(run.status, "succeeded");
    assert.deepEqual(run.result?.notices, []);
    for (const post of kleinPosts()) {
      assert.equal(post.assetIds.length, 1);
      assert.match(post.prompt, /a pair of well-groomed hands/);
      assert.doesNotMatch(post.prompt, /images 2-4/);
    }
  });

  it("on_model falls back to an archetype text model", async () => {
    const run = await shoot({ mode: "on_model" });
    assert.equal(run.status, "succeeded");
    assert.deepEqual(run.result?.notices, []);
    for (const post of kleinPosts()) {
      assert.equal(post.assetIds.length, 1);
      assert.match(post.prompt, /a professional adult model/);
    }
  });
});

describe("photoshoot with an Identity that can't be used", () => {
  it("an unknown Identity is a 404 on identityId, and nothing is submitted", async () => {
    const created = await runner.createRun("photoshoot", { mode: "hands_on", images: [{ upload: "product" }], identityId: randomUUID() }, uploads());
    assert.ok(!created.ok);
    assert.equal(created.status, 404);
    assert.equal(created.field, "identityId");
    assert.equal(mock.state.jobPosts.length, 0);
  });

  it("an Identity with no consent record is a 400 on identityId, and nothing is submitted", async () => {
    const id = randomUUID();
    await mkdir(join(registry.identitiesDir(), id), { recursive: true });
    const doc = { schema: IDENTITY_SCHEMA, id, name: "No consent", createdAt: new Date().toISOString(), refs: [] };
    await writeFile(join(registry.identitiesDir(), id, "identity.json"), JSON.stringify(doc));
    const created = await runner.createRun("photoshoot", { mode: "on_model", images: [{ upload: "product" }], identityId: id }, uploads());
    assert.ok(!created.ok);
    assert.equal(created.status, 400);
    assert.equal(created.field, "identityId");
    assert.equal(mock.state.jobPosts.length, 0);
  });
});
