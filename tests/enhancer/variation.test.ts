import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASPECT_RATIOS } from "../../lib/contracts/photoshoot.ts";
import { DEMO_MODES, KLEIN_SIZES, MAX_OUTPUTS, MODE_TEMPLATES } from "../../lib/enhancer/modes.ts";
import { buildPrompts } from "../../lib/enhancer/variation.ts";

const AXES = ["preset", "lighting", "angle", "palette"] as const;

describe("MODE_TEMPLATES", () => {
  it("covers the five demo modes", () => {
    assert.deepEqual(DEMO_MODES, ["packshot", "in_context", "wide_banner", "mood_still", "carousel_set"]);
  });

  for (const mode of DEMO_MODES) {
    it(`${mode} is well formed`, () => {
      const t = MODE_TEMPLATES[mode];
      assert.equal(t.mode, mode);
      assert.ok(t.label.length > 0);
      assert.ok((t.aspects as readonly string[]).includes(t.defaultAspect));
      for (const a of t.aspects) assert.ok((ASPECT_RATIOS as readonly string[]).includes(a));
      assert.ok(t.count.def >= t.count.min && t.count.def <= t.count.max);
      assert.ok(t.count.max <= MAX_OUTPUTS);
      for (const axis of AXES) assert.ok((t.pools[axis]?.length ?? 0) >= MAX_OUTPUTS, `${mode}.${axis} pool`);
      for (const slot of ["{product}", "{style}", "{lighting}", "{angle}", "{palette}"]) {
        assert.ok(t.promptTemplate.includes(slot), `${mode} template lacks ${slot}`);
      }
    });
  }

  it("only carousel_set is style locked", () => {
    for (const mode of DEMO_MODES) assert.equal(MODE_TEMPLATES[mode].sharedStyle, mode === "carousel_set");
  });

  it("klein sizes are multiples of 16 near 1 MP", () => {
    for (const { width, height } of Object.values(KLEIN_SIZES)) {
      assert.equal(width % 16, 0);
      assert.equal(height % 16, 0);
      assert.ok(width * height > 0.85e6 && width * height < 1.1e6);
    }
  });
});

describe("buildPrompts", () => {
  it("is deterministic", () => {
    const t = MODE_TEMPLATES.in_context;
    assert.deepEqual(buildPrompts(t, "matte bottle", 4, 42), buildPrompts(t, "matte bottle", 4, 42));
  });

  it("returns n prompts with filled slots and notes", () => {
    const out = buildPrompts(MODE_TEMPLATES.packshot, "amber glass", 3, 7);
    assert.equal(out.length, 3);
    for (const p of out) {
      assert.doesNotMatch(p.prompt, /\{\w+\}/);
      assert.match(p.prompt, /image 1/);
      assert.match(p.prompt, /Notes: amber glass\./);
    }
  });

  for (const mode of DEMO_MODES.filter((m) => !MODE_TEMPLATES[m].sharedStyle)) {
    it(`${mode}: any two of N≤4 differ on ≥2 axes, seeds are base+i`, () => {
      for (const seed of [0, 1, 42, 123456789, 2 ** 32 - 1]) {
        const out = buildPrompts(MODE_TEMPLATES[mode], "", 4, seed);
        for (let i = 0; i < out.length; i++) {
          assert.equal(out[i].seed, (seed + i) >>> 0);
          for (let j = i + 1; j < out.length; j++) {
            const diff = AXES.filter((a) => out[i].variation[a] !== out[j].variation[a]).length;
            assert.ok(diff >= 2, `${mode} seed ${seed}: items ${i},${j} differ on ${diff}`);
            assert.notEqual(out[i].prompt, out[j].prompt);
          }
        }
      }
    });
  }

  it("carousel_set locks style and seed, varies angle and role, closes with CTA", () => {
    const out = buildPrompts(MODE_TEMPLATES.carousel_set, "", 4, 99);
    const styleBlock = out[0].prompt.split(". ")[0];
    for (const p of out) {
      assert.equal(p.seed, 99);
      assert.equal(p.variation.preset, out[0].variation.preset);
      assert.equal(p.variation.lighting, out[0].variation.lighting);
      assert.equal(p.variation.palette, out[0].variation.palette);
      assert.ok(p.prompt.startsWith(styleBlock));
    }
    assert.equal(new Set(out.map((p) => p.variation.angle)).size, 4);
    assert.equal(new Set(out.map((p) => p.role)).size, 4);
    assert.match(out[3].role ?? "", /closing/);
    assert.match(out[0].role ?? "", /cover/);
  });

  it("snapshot: packshot seed 42", () => {
    const [first] = buildPrompts(MODE_TEMPLATES.packshot, "", 1, 42);
    assert.deepEqual(first, SNAPSHOT);
  });
});

const SNAPSHOT = {
  "index": 0,
  "prompt": "Professional e-commerce photo of the product from image 1, unchanged: same shape, label, colour, placed on a pure white seamless backdrop. Overcast diffuse light, macro close-up, cool minimal tones. Clean catalog composition, sharp focus, no text, no letters, no logos.",
  "seed": 42,
  "variation": {
    "preset": "pure white seamless backdrop",
    "lighting": "overcast diffuse light",
    "angle": "macro close-up",
    "palette": "cool minimal tones"
  }
};
