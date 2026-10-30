/**
 * Product Shoot round-3 review fixes: frames are laid out from the resolved
 * aspect (never the raw requested ratio), the notes cap is one shared
 * constant, and step errors read as short human reasons.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import type { PlanContext } from "../../lib/pipeline/types.ts";
import { MAX_NOTES, errorDetail, humanReason } from "../../lib/photoshoot/copy.ts";
import { photoshootPipeline, validatePhotoshoot } from "../../lib/photoshoot/pipeline.ts";

const ctx: PlanContext = { runId: "run_1", now: "2026-10-30T00:00:00.000Z", randomSeed: () => 1000 };

describe("photoshoot round-3 fixes", () => {
  it("stores the snapped aspect on every shot step, not an arbitrary requested ratio", async () => {
    const request = { mode: "packshot" as const, prompt: "", images: [{ assetId: "a" }], count: 2, aspectRatio: "9999:1" as never };
    assert.equal(validatePhotoshoot(request).ok, true);
    const steps = await photoshootPipeline.plan(request, ctx);
    const shots = steps.filter((s) => s.id.startsWith("shot-"));
    assert.equal(shots.length, 2);
    for (const shot of shots) {
      const aspect = (shot.data as { aspect?: string }).aspect;
      assert.ok(aspect && aspect !== "9999:1", `stored ${aspect}`);
      assert.match(aspect, /^\d+:\d+$/);
    }
  });

  it("caps notes at the shared MAX_NOTES on the server and in the studio field", async () => {
    const base = { mode: "packshot", images: [{ assetId: "a" }], count: 1 };
    assert.equal(validatePhotoshoot({ ...base, prompt: "x".repeat(MAX_NOTES) }).ok, true);
    const over = validatePhotoshoot({ ...base, prompt: "x".repeat(MAX_NOTES + 1) });
    assert.equal(over.ok, false);
    const studio = await readFile(new URL("../../components/photoshoot/photoshoot-studio.tsx", import.meta.url), "utf8");
    assert.match(studio, /maxLength=\{MAX_NOTES\}/);
    assert.doesNotMatch(studio, /maxLength=\{\d+\}/);
  });

  it("turns error codes into short human reasons, keeping the detail for a tooltip", () => {
    for (const code of [
      "cutout_failed",
      "content_moderated",
      "poll_failed",
      "timed_out",
      "output_download_failed",
      "submit_unconfirmed",
      "input_missing",
      "node_execution_error",
    ]) {
      const reason = humanReason({ code, message: "raw detail" });
      assert.ok(reason && !reason.includes(code) && !reason.includes("raw detail"), `${code}: ${reason}`);
    }
    assert.equal(humanReason(null), null);
    assert.ok(humanReason({ code: "something_new", message: "x" }));
    assert.equal(errorDetail({ code: "poll_failed", message: "fetch failed" }), "poll_failed: fetch failed");
  });
});
