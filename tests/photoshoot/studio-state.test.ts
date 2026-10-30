/**
 * Photoshoot studio UX fixes: a recovered run restores the slate it was shot
 * with, run progress reads from `run.progress`, and no prompt invites the
 * model to draw text (titles, hooks, calls to action, slide labels).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEMO_MODES, MODE_TEMPLATES } from "../../lib/enhancer/modes.ts";
import { buildPrompts } from "../../lib/enhancer/variation.ts";
import { runProgress, slateFromRequest } from "../../lib/photoshoot/studio-state.ts";
import type { PipelineStep } from "../../lib/contracts/pipeline.ts";

describe("slateFromRequest", () => {
  it("restores a carousel run's mode, count and notes", () => {
    assert.deepEqual(slateFromRequest({ mode: "carousel_set", count: 4, prompt: "on linen" }, "in_context"), {
      mode: "carousel_set",
      count: 4,
      notes: "on linen",
    });
  });

  it("clamps the count into the mode's range, like the plan does", () => {
    assert.equal(slateFromRequest({ mode: "carousel_set", count: 1, prompt: "" }, "in_context").count, 3);
    assert.equal(slateFromRequest({ mode: "packshot", count: 9, prompt: "" }, "in_context").count, 4);
  });

  it("falls back to the given mode for an unknown one", () => {
    const slate = slateFromRequest({ mode: "restage" as never, count: 2, prompt: "" }, "in_context");
    assert.equal(slate.mode, "in_context");
    assert.equal(slate.count, 2);
  });
});

describe("runProgress", () => {
  const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }) as PipelineStep);

  it("counts finished jobs from the run's progress fraction", () => {
    assert.deepEqual(runProgress({ progress: 3 / 5, steps: steps(5) }), { done: 3, total: 5, fraction: 0.6 });
    assert.deepEqual(runProgress({ progress: 1, steps: steps(5) }), { done: 5, total: 5, fraction: 1 });
  });

  it("clamps a malformed progress", () => {
    assert.equal(runProgress({ progress: Number.NaN, steps: steps(3) }).done, 0);
    assert.equal(runProgress({ progress: 2, steps: steps(3) }).done, 3);
  });
});

describe("prompts never invite rendered text", () => {
  // Words a model tends to letter onto the image ("Cover Hook", "Shop now").
  const TEXTY = /\b(title|headline|hook|call[- ]to[- ]action|cta|caption|slogan|tagline)\b|slide \d+ role/i;

  for (const mode of DEMO_MODES) {
    it(`${mode}: every prompt bans text and asks for none`, () => {
      const template = MODE_TEMPLATES[mode];
      for (const p of buildPrompts(template, "", template.count.max, 7)) {
        assert.doesNotMatch(p.prompt, TEXTY, p.prompt);
        assert.match(p.prompt, /no text, no letters, no logos/);
      }
    });
  }

  it("carousel cover asks for empty negative space", () => {
    const [cover] = buildPrompts(MODE_TEMPLATES.carousel_set, "", 4, 7);
    assert.match(cover.prompt, /empty negative space in the upper third/);
  });
});
