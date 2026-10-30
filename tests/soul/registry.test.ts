/**
 * Identity registry, bundles and the preview pipeline against the offline mock
 * Comfy, including the unit-level S-R1 reuse test (docs/spec/identity.md §6.6):
 * create → preview job → export → wipe → import → refs re-uploaded → stale
 * asset re-uploaded by sha256 with no extra job. Synthetic photos only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";

import { startMockComfy, type MockComfy } from "../mock-comfy/server.ts";
import sharp from "sharp";

import { faceAt, fakeDetector, noisePhoto, oneFace } from "./helpers.ts";

let mock: MockComfy;
let dir: string;
let registry: typeof import("../../lib/soul/registry.ts");
let intake: typeof import("../../lib/identity/intake.ts");
let runner: typeof import("../../lib/pipeline/runner.ts");
let pipeline: typeof import("../../lib/soul/pipeline.ts");

before(async () => {
  mock = await startMockComfy();
  dir = await mkdtemp(join(tmpdir(), "oss-identity-"));
  process.env.COMFY_BASE_URL = mock.url;
  process.env.COMFY_API_KEY = "test-key";
  process.env.DATA_DIR = dir;
  registry = await import("../../lib/soul/registry.ts");
  intake = await import("../../lib/identity/intake.ts");
  runner = await import("../../lib/pipeline/runner.ts");
  pipeline = await import("../../lib/soul/pipeline.ts");
});

after(async () => {
  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function photos(n: number): Promise<Uint8Array[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => noisePhoto(1200, 1500, { seedShift: i * 9 - 20 })));
}

describe("intake", () => {
  it("refuses without consent before decoding anything", async () => {
    await assert.rejects(intake.intakeIdentity({ name: "maya", consent: undefined, photos: await photos(1) }, { detect: oneFace }), /consent/i);
  });

  it("returns 3+ failures as a refusal, without saving", async () => {
    const bad = new TextEncoder().encode("nope");
    const result = await intake.intakeIdentity({ name: "maya", consent: "true", photos: [bad, bad, bad] }, { detect: oneFace });
    assert.equal(result.ok, false);
    assert.deepEqual(result.photos.map((p) => p.reason), ["unsupported_type", "unsupported_type", "unsupported_type"]);
    assert.deepEqual(await registry.listSouls(), []);
  });
});

describe("S-R1: identity reuse across separate jobs", () => {
  let id = "";

  it("creates an identity with 3–6 refs, each with sha256, and no Comfy upload", async () => {
    const before = mock.state.assets.size;
    const result = await intake.intakeIdentity({ name: "Maya", consent: "true", photos: await photos(5), styleCard: { description: "short dark hair" } }, { detect: oneFace });
    assert.ok(result.ok);
    id = result.identity.id;
    assert.ok(result.identity.refs.length >= 3 && result.identity.refs.length <= 6);
    for (const ref of result.identity.refs) {
      assert.match(ref.sha256, /^[0-9a-f]{64}$/);
      assert.equal(ref.assetId, undefined);
    }
    assert.equal(mock.state.assets.size, before, "QA and saving never upload");
    assert.equal((await registry.getSoul(id))?.styleCard.description, "short dark hair");
  });

  it("job A: renders a preview from the crops (uploaded once)", async () => {
    const soul = (await registry.getSoul(id))!;
    const ready = await registry.ensureAssets(soul);
    const assets = mock.state.assets.size;
    await registry.ensureAssets(soul);
    assert.equal(mock.state.assets.size, assets, "a live cache is not re-uploaded");
    const refIds = ready.refs.slice(0, 4).map((r) => r.assetId);
    const created = await runner.createRun("identity", { name: "Maya", consent: true, photos: refIds.map((assetId) => ({ assetId })), preview: true });
    assert.ok(created.ok, !created.ok ? created.error : "");
    await runner.whenIdle(created.run.id);
    const run = (await runner.getRun(created.run.id))!;
    assert.equal(run.status, "succeeded");
    const result = run.result as { identity: { id: string }; preview: unknown };
    assert.equal(result.identity.id, id);
    assert.ok(result.preview, "preview output present");
    const job = mock.state.jobPosts.at(-1)!;
    for (const assetId of refIds) assert.ok(job.assetIds.includes(assetId!), "every ref slot bound to a crop asset");
  });

  let bundle: Uint8Array;
  it("exports a portable bundle: identity.json + refs, no asset ids or URLs, hashes match", async () => {
    const { filename, bytes } = await registry.exportBundle(id);
    assert.equal(filename, "maya.identity.zip");
    bundle = bytes;
    const files = unzipSync(bytes);
    const text = strFromU8(files["identity.json"]);
    assert.ok(!text.includes("assetId") && !text.includes("http"), "no asset ids or URLs");
    const doc = JSON.parse(text) as { refs: { path: string; sha256: string }[] };
    for (const ref of doc.refs) assert.equal(sha(files[ref.path]), ref.sha256);
  });

  it("cold restart → import → refs re-upload with fresh asset ids", async () => {
    const oldIds = new Set((await registry.getSoul(id))!.refs.map((r) => r.assetId));
    await rm(join(dir, "identities"), { recursive: true, force: true });
    assert.equal(await registry.getSoul(id), null);
    const imported = await registry.importBundle(bundle, "true", { detect: oneFace });
    assert.notEqual(imported.id, id);
    // The SDK dedups by content hash, so a re-upload may be a from-hash copy:
    // count new asset ids, not multipart POSTs.
    const assets = mock.state.assets.size;
    const refs = await registry.bestRefs(imported.id, 3);
    assert.equal(refs.length, 3);
    assert.equal(mock.state.assets.size - assets, imported.refs.length, "every ref uploaded again");
    for (const ref of refs) assert.ok(!oldIds.has(ref.assetId));
    id = imported.id;
  });

  it("a stale cached asset is re-uploaded by sha256, with no job submitted", async () => {
    const soul = (await registry.getSoul(id))!;
    const ready = await registry.ensureAssets(soul);
    const stale = ready.refs[0].assetId;
    mock.state.scenario = "asset_missing";
    mock.state.missingAssetIds = new Set([stale]);
    const jobs = mock.state.jobPosts.length;
    const assets = mock.state.assets.size;
    const refs = await registry.bestRefs(id, 6);
    assert.notEqual(refs[0].assetId, stale);
    assert.equal(mock.state.assets.size - assets, 1, "exactly the missing ref");
    assert.equal(mock.state.jobPosts.length, jobs);
    mock.state.scenario = "succeeded";
    mock.state.missingAssetIds = new Set();
  });

  it("delete removes the local folder and the cached assets", async () => {
    const result = await registry.deleteIdentity(id);
    assert.equal(result.deleted, true);
    assert.equal(await registry.getSoul(id), null);
    assert.deepEqual(await readdir(join(dir, "identities")), []);
    await assert.rejects(registry.bestRefs(id, 3), { name: "SoulNotFoundError" });
  });
});

describe("bundle import is untrusted", () => {
  const png = async () => {
    const [photo] = await photos(1);
    const r = await (await import("../../lib/identity/qa.ts")).checkPhoto(photo, 0, { detect: oneFace });
    return (r as { png: Uint8Array }).png;
  };
  async function bundleWith(edit: (doc: Record<string, unknown>, files: Record<string, Uint8Array>) => void) {
    const files: Record<string, Uint8Array> = {};
    const refs = [];
    for (let n = 0; n < 3; n++) {
      const bytes = await png();
      files[`refs/ref_${n}.png`] = bytes;
      refs.push({ path: `refs/ref_${n}.png`, sha256: sha(bytes), phash: "0123456789abcdef", crop: { x: 0, y: 0, width: 10, height: 10 } });
    }
    const doc: Record<string, unknown> = { schema: "open-frame-studio/identity@1", id: "x", name: "z", createdAt: "", refs, styleCard: { description: "", traits: {}, keep: [] } };
    edit(doc, files);
    files["identity.json"] = strToU8(JSON.stringify(doc));
    return zipSync(files);
  }

  it("rejects a tampered ref, an escaping path, a bad schema and too few refs", async () => {
    await assert.rejects(registry.importBundle(await bundleWith((_d, f) => (f["refs/ref_1.png"] = new Uint8Array([1, 2, 3]))), "true", { detect: oneFace }), /sha256/);
    await assert.rejects(registry.importBundle(await bundleWith((d) => ((d.refs as { path: string }[])[0].path = "../evil.png")), "true", { detect: oneFace }), /relative/);
    await assert.rejects(registry.importBundle(await bundleWith((d) => (d.schema = "open-frame-studio/identity@9")), "true", { detect: oneFace }), /Unsupported/);
    await assert.rejects(registry.importBundle(await bundleWith((d) => (d.refs = (d.refs as unknown[]).slice(0, 2))), "true", { detect: oneFace }), /needs 3/);
    await assert.rejects(registry.importBundle(new Uint8Array([1, 2, 3]), "true", { detect: oneFace }), /readable/);
  });

  it("accepts a valid bundle, recording the importer's consent", async () => {
    const soul = await registry.importBundle(await bundleWith(() => undefined), "true", { detect: oneFace });
    assert.equal(soul.refs.length, 3);
    assert.ok(soul.refs.every((r) => r.path && !r.assetId));
    assert.ok(soul.consentedAt && !Number.isNaN(Date.parse(soul.consentedAt)));
    assert.equal((await registry.getSoul(soul.id))?.consentedAt, soul.consentedAt);
  });

  it("refuses an import without likeness consent, before reading the bundle", async () => {
    for (const consent of [undefined, "false", ""]) {
      await assert.rejects(registry.importBundle(await bundleWith(() => undefined), consent, { detect: oneFace }), /consent/i);
    }
    await assert.rejects(registry.importBundle(new Uint8Array([1, 2, 3]), undefined), /consent/i);
  });

  it("zip bomb: refuses extra entries, too many entries and oversized declared sizes before inflating", async () => {
    const valid = unzipSync(await bundleWith(() => undefined));
    // A valid bundle plus files an export never has.
    await assert.rejects(registry.importBundle(zipSync({ ...valid, "junk.bin": new Uint8Array(10) }), "true", { detect: oneFace }), /never has/);
    // Many entries of zeros (each compresses to ~1 KB): refused on the count, not after inflating them all.
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 60; i++) many[`d${i}/identity.json`] = new Uint8Array(1024 * 1024);
    await assert.rejects(registry.importBundle(zipSync(many, { level: 9 }), "true", { detect: oneFace }), /too many files/);
    // Only allowed names, but 16 MB of zeros each: refused on the declared sizes.
    const big: Record<string, Uint8Array> = { "identity.json": strToU8("{}") };
    for (let n = 0; n < 6; n++) big[`refs/ref_${n}.png`] = new Uint8Array(16 * 1024 * 1024);
    const bomb = zipSync(big, { level: 9 });
    assert.ok(bomb.byteLength < 1024 * 1024, "the bomb is small on the wire");
    await assert.rejects(registry.importBundle(bomb, "true", { detect: oneFace }), /too large/);
    // One leading folder (as some zip tools write) is still fine.
    const nested: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(valid)) nested[`maya.identity/${k}`] = v;
    assert.equal((await registry.importBundle(zipSync(nested), "true", { detect: oneFace })).refs.length, 3);
  });

  it("runs the face detector on small imported refs, and validates crop boxes", async () => {
    const small = async (seed: number) => {
      const buf = await sharp({ create: { width: 320, height: 400, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128 + seed, sigma: 60 } } }).png().toBuffer();
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    };
    const smallBundle = async (crop: unknown = { x: 0, y: 0, width: 320, height: 400 }) => {
      const files: Record<string, Uint8Array> = {};
      const refs = [];
      for (let n = 0; n < 3; n++) {
        const bytes = await small(n * 10);
        files[`refs/ref_${n}.png`] = bytes;
        refs.push({ path: `refs/ref_${n}.png`, sha256: sha(bytes), phash: "0123456789abcdef", crop });
      }
      files["identity.json"] = strToU8(JSON.stringify({ schema: "open-frame-studio/identity@1", id: "x", name: "z", createdAt: "", refs, styleCard: { description: "", traits: {}, keep: [] } }));
      return zipSync(files);
    };
    const noFace = fakeDetector(() => []);
    const bigFace = fakeDetector((w, h) => [faceAt(w, h, 0.2, 0.15, 0.6)]);
    await assert.rejects(registry.importBundle(await smallBundle(), "true", { detect: noFace }), /no face/);
    // A small crop with a face is a legitimate stored ref (§5.1 clamps to the image).
    assert.equal((await registry.importBundle(await smallBundle(), "true", { detect: bigFace })).refs.length, 3);
    for (const crop of [null, { x: -1, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }, { x: "1", y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1e400, height: 10 }]) {
      await assert.rejects(registry.importBundle(await smallBundle(crop), "true", { detect: bigFace }), /crop box/, `crop ${JSON.stringify(crop)}`);
    }
  });
});

describe("identities need consent", () => {
  it("createIdentity refuses without consent", async () => {
    const [photo] = await photos(1);
    const c = await (await import("../../lib/identity/qa.ts")).checkPhoto(photo, 0, { detect: oneFace });
    const refs = [c, c, c] as never;
    await assert.rejects(registry.createIdentity({ name: "a", consent: undefined, refs }), /consent/i);
    assert.ok((await registry.createIdentity({ name: "a", consent: "true", refs })).consentedAt);
  });
});

describe("preview pipeline validation", () => {
  it("refuses (400, no job) asset ids that are not one saved identity's crops", async () => {
    const jobs = mock.state.jobPosts.length;
    const created = await runner.createRun("identity", { name: "a", consent: true, photos: [{ assetId: "11111111-1111-4111-8111-111111111111" }] });
    assert.equal(created.ok, false);
    assert.equal(!created.ok && created.status, 400);
    assert.equal(!created.ok && created.field, "photos");
    assert.equal(mock.state.jobPosts.length, jobs, "nothing submitted");
  });

  it("refuses raw uploads (originals never go to Comfy) and missing consent", () => {
    const v = pipeline.validateIdentity({ name: "a", consent: true, photos: [{ upload: "p0" }] });
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.field, "photos[0]");
    const c = pipeline.validateIdentity({ name: "a", photos: [{ assetId: "x" }] });
    assert.equal(!c.ok && c.field, "consent");
  });

  it("names the refs in plain words for FLUX.2", () => {
    assert.match(pipeline.previewPrompt(3), /images 1, 2 and 3/);
    assert.match(pipeline.previewPrompt(1, "red scarf"), /image 1:.*red scarf\./);
  });
});
