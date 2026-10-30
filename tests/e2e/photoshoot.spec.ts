/**
 * Product Shoot: 10 modes, <=4-question interview, 1-10 varied outputs, aspect whitelist.
 * Spec: docs/spec/photoshoot.md. Product fixtures: fixtures/products/*.png (procedural).
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { resetMock, setMockScenario } from "../mock-comfy/control.ts";

const PRODUCT = join(process.cwd(), "fixtures/products/product-bottle-confetti.png");
const MODES = [
  "packshot",
  "in_context",
  "hands_on",
  "mood_still",
  "wide_banner",
  "carousel_set",
  "ad_variants",
  "on_model",
  "concept",
  "restage",
] as const;
const ASPECTS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const;

test.beforeEach(async () => {
  await resetMock();
});

test("Photoshoot page renders", async ({ page }) => {
  await page.goto("/photoshoot");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/product shoot/i);
});

test.describe("Photoshoot dock", () => {
  test.fixme("mode rail lists all 10 modes and the aspect picker only offers the whitelist", async ({ page }) => {
    // TODO(wave2 frontend: Photoshoot dock): one control per mode in MODES; aspect options equal ASPECTS;
    // mood_still defaults to 2:3, wide_banner to a >=16:9 aspect.
    await page.goto("/photoshoot");
    expect(MODES).toHaveLength(10);
    expect(ASPECTS).toHaveLength(9);
  });

  test.fixme("interview asks at most 4 questions with chip answers", async ({ page }) => {
    // TODO(wave2 frontend + enhancer router): free-text request routes to a mode; interview shows
    // <=4 questions, each answerable by a labelled chip; skipping keeps defaults.
    await page.goto("/photoshoot");
  });

  test.fixme("packshot x4: upload product, generate, gallery shows 4 varied images", async ({ page }) => {
    // TODO(wave2): setInputFiles(PRODUCT); count=4; submit. Mock multi_output returns images+video;
    // gallery must show only images for photoshoot. Assert 4 tiles, each src under /api/jobs/.../outputs/...
    // and each request body (mockRequests().jobPosts) carries a different preset/light/angle/palette prompt.
    await setMockScenario({ scenario: "multi_output" });
    await page.goto("/photoshoot");
    void PRODUCT;
  });

  test.fixme("carousel_set shares one style block across 3-10 slides", async ({ page }) => {
    // TODO(wave2 enhancer style lock): N slides submitted; prompts differ but share the style block.
    await page.goto("/photoshoot");
  });

  test.fixme("long job: queued then progress, cancel is not offered as a retry", async ({ page }) => {
    // TODO(wave2 Motion/progress HUD shared component): queued_20s (shortened) -> slow_progress.
    await setMockScenario({ scenario: "slow_progress" });
    await page.goto("/photoshoot");
  });
});
