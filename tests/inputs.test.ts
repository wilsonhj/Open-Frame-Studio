import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { applyBindings, type ApiGraph } from "../lib/bindings/apply.ts";
import { BINDINGS } from "../lib/bindings/index.ts";
import { InputError, parseInputs, seedsOf, verifyImageBytes } from "../lib/inputs.ts";
import type { AssetHandle } from "../lib/types.ts";
import { CARD_ASSETS, PHOTOSHOOT_MODES } from "../lib/types.ts";

const binding = BINDINGS.image_resize_smoke;
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "in.png", { type: "image/png" });
const ASSET: AssetHandle = { __type: "core/ASSET", info: { id: "asset_1" } };
const toAsset = () => ASSET;

function form(entries: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function smokeGraph(): Promise<ApiGraph> {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", "image_resize_smoke.api.json"), "utf-8")) as ApiGraph;
}

describe("contracts", () => {
  it("has 13 card assets and 10 photoshoot modes", () => {
    assert.equal(CARD_ASSETS.length, 13);
    assert.equal(PHOTOSHOOT_MODES.length, 10);
  });
});

describe("parseInputs", () => {
  it("leaves absent optional fields to the graph defaults and validates ranges / choices", async () => {
    const values = await parseInputs(binding, form({ image: png() }), toAsset);
    assert.deepEqual(values, { image: ASSET });
    const next = applyBindings(await smokeGraph(), binding, values);
    assert.equal(next["2"].inputs.scale_by, 0.5);
    assert.equal(next["2"].inputs.upscale_method, "lanczos");

    await assert.rejects(parseInputs(binding, form({ image: png(), scale: "9" }), toAsset), InputError);
    await assert.rejects(parseInputs(binding, form({ image: png(), scale: "abc" }), toAsset), /must be a number/);
    await assert.rejects(parseInputs(binding, form({ image: png(), method: "magic" }), toAsset), InputError);
  });

  it("requires the image and checks its type", async () => {
    await assert.rejects(parseInputs(binding, form({}), toAsset), /Upload an image/);
    const gif = new File([new Uint8Array([1])], "a.gif", { type: "image/gif" });
    await assert.rejects(parseInputs(binding, form({ image: gif }), toAsset), /PNG, JPEG or WebP/);
  });

  it("validates every field before creating any asset", async () => {
    let calls = 0;
    const counting = () => {
      calls += 1;
      return ASSET;
    };
    await assert.rejects(parseInputs(binding, form({ image: png(), scale: "9" }), counting), InputError);
    assert.equal(calls, 0);
  });

  it("parses per GraphValueKind", async () => {
    const h3 = BINDINGS.h3_r2v;
    const values = await parseInputs(
      h3,
      form({ seed: "42", duration: "5.5", turbo: "off", prompt: "  hello  ", image_1: png() }),
      toAsset,
    );
    assert.deepEqual(values, { image_1: ASSET, prompt: "hello", seed: 42, duration: 5.5, turbo: false });
    await assert.rejects(parseInputs(h3, form({ seed: "1.5", image_1: png() }), toAsset), /whole number/);
    await assert.rejects(parseInputs(h3, form({ turbo: "maybe", image_1: png() }), toAsset), /true or false/);
    await assert.rejects(parseInputs(h3, form({ prompt: png(), image_1: png() }), toAsset), /text field/);
    await assert.rejects(parseInputs(h3, form({ seed: "1" }), toAsset), /Upload an image for "image_1"/);
  });

  it("produces values that apply to the bound node fields", async () => {
    const values = await parseInputs(binding, form({ image: png(), scale: "0.25" }), toAsset);
    const next = applyBindings(await smokeGraph(), binding, values);
    assert.equal(next["1"].inputs.image, ASSET);
    assert.equal(next["2"].inputs.scale_by, 0.25);
    assert.equal(next["2"].inputs.upscale_method, "lanczos");
  });
});

describe("upload byte check", () => {
  const file = (bytes: number[], type: string) => new File([new Uint8Array(bytes)], "in", { type });
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0];
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0];
  const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];
  const HTML = [...Buffer.from("<html><script>")];

  it("accepts files whose leading bytes match the declared type", async () => {
    await verifyImageBytes({ image: file(PNG, "image/png") });
    await verifyImageBytes({ image: file(JPEG, "image/jpeg") });
    await verifyImageBytes({ image: file(WEBP, "image/webp"), scale: 0.5 });
  });

  it("rejects a mislabelled upload before any asset is created", async () => {
    await assert.rejects(verifyImageBytes({ image: file(HTML, "image/png") }), InputError);
    await assert.rejects(verifyImageBytes({ image: file(JPEG, "image/png") }), /does not start like a PNG/);
    let assets = 0;
    const binding = BINDINGS.image_resize_smoke;
    await assert.rejects(
      parseInputs(binding, form({ image: file(HTML, "image/png") }), () => {
        assets += 1;
        return ASSET;
      }),
      /does not start like a PNG/,
    );
    assert.equal(assets, 0);
  });
});

describe("randomized seeds", () => {
  const t2i = BINDINGS.klein_t2i;

  it("marks the generation seeds randomize, and leaves the upscale seed fixed", () => {
    assert.equal(BINDINGS.klein_t2i.inputs.seed.randomize, true);
    assert.equal(BINDINGS.klein_edit_multiref.inputs.seed.randomize, true);
    assert.equal(BINDINGS.h3_r2v.inputs.seed.randomize, true);
    assert.equal("randomize" in BINDINGS.upscale.inputs.seed, false);
  });

  it("fills a fresh random seed when the form omits it, and keeps a locked one", async () => {
    const a = (await parseInputs(t2i, form({}), toAsset)).seed;
    const b = (await parseInputs(t2i, form({}), toAsset)).seed;
    assert.ok(Number.isSafeInteger(a) && (a as number) >= 0, "a random non-negative safe integer");
    assert.notEqual(a, b, "two unlocked runs get different seeds");
    const locked = await parseInputs(t2i, form({ seed: "1234" }), toAsset);
    assert.equal(locked.seed, 1234);
    assert.deepEqual(seedsOf(t2i, locked), { seed: 1234 });
    await assert.rejects(parseInputs(t2i, form({ seed: "-1" }), toAsset), /≥ 0/);
    await assert.rejects(parseInputs(t2i, form({ seed: "1.5" }), toAsset), /whole number/);
  });

  it("returns no seeds for a workflow without randomize inputs", async () => {
    const values = await parseInputs(binding, form({ image: png() }), toAsset);
    assert.deepEqual(seedsOf(binding, values), {});
  });
});
