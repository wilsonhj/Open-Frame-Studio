import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BINDINGS, getBinding } from "../lib/bindings/index.ts";
import { InputError, applyInputs, resolveInputs } from "../lib/inputs.ts";
import { LISTING_SLOTS, OUTPUT_FORMATS, SHOT_STYLES } from "../lib/types.ts";

const binding = BINDINGS.image_resize_smoke;
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "in.png", { type: "image/png" });

function form(entries: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("contracts", () => {
  it("has our own shot styles, output formats and listing slots", () => {
    assert.equal(SHOT_STYLES.length, 6);
    assert.equal(OUTPUT_FORMATS.length, 4);
    assert.equal(LISTING_SLOTS.length, 11);
  });

  it("only exposes registered workflows", () => {
    assert.ok(getBinding("image_resize_smoke"));
    assert.equal(getBinding("__proto__"), undefined);
    assert.equal(getBinding("../secrets"), undefined);
  });
});

describe("resolveInputs", () => {
  it("applies defaults and validates ranges", () => {
    const values = resolveInputs(binding, form({ image: png() }));
    assert.equal(values.scale, 0.5);
    assert.equal(values.method, "lanczos");
    assert.ok(values.image instanceof File);

    assert.throws(() => resolveInputs(binding, form({ image: png(), scale: "9" })), InputError);
    assert.throws(() => resolveInputs(binding, form({ image: png(), method: "magic" })), InputError);
  });

  it("requires the image and checks its type", () => {
    assert.throws(() => resolveInputs(binding, form({})), /Upload an image/);
    const gif = new File([new Uint8Array([1])], "a.gif", { type: "image/gif" });
    assert.throws(() => resolveInputs(binding, form({ image: gif })), /PNG, JPEG or WebP/);
  });

  it("applies values to the bound node fields, images via the asset factory", async () => {
    const set: Array<[string, string, unknown]> = [];
    const values = resolveInputs(binding, form({ image: png(), scale: "0.25" }));
    await applyInputs({ setInput: (n, f, v) => set.push([n, f, v]) }, binding, values, () => "ASSET");
    assert.deepEqual(
      set.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
      [
        ["1", "image", "ASSET"],
        ["2", "scale_by", 0.25],
        ["2", "upscale_method", "lanczos"],
      ],
    );
  });
});
