/**
 * Motion (MiniMax H3 reference-to-video): Identity still + product still -> short clip.
 * Graph: workflows/h3_r2v.api.json (spike: docs/spikes/h3-r2v.md). Turbo for live, 20-25 steps for hero.
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { resetMock, setMockScenario } from "../mock-comfy/control.ts";

const PRODUCT = join(process.cwd(), "fixtures/products/product-bottle-confetti.png");

test.beforeEach(async () => {
  await resetMock();
});

test("Motion page renders", async ({ page }) => {
  await page.goto("/motion");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/motion/i);
});

test.describe("Motion panel", () => {
  test.fixme("Identity + product -> clip renders in a <video> element", async ({ page }) => {
    // TODO(wave2 frontend: Motion panel): pick an identity (imported identity.json) + upload PRODUCT; submit.
    // Mock multi_output returns 2 images + 1 video/mp4 (node 12): the panel must render the video
    // output in <video src="/api/jobs/.../outputs/..."> and ignore/thumbnail the images.
    // The MP4 is a stub (ftyp box only): assert src + content-type, not playback.
    await setMockScenario({ scenario: "multi_output" });
    await page.goto("/motion");
    void PRODUCT;
  });

  test.fixme("long H3 job: queue wait then a rising progress bar", async ({ page }) => {
    // TODO(wave2 progress HUD): queued_20s with queuedMs ~3000 shows queue position; then
    // slow_progress shows progress increasing across polls until the clip appears.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 3_000 });
    await page.goto("/motion");
  });

  test.fixme("turbo vs hero toggle changes steps in the submitted graph", async ({ page }) => {
    // TODO(wave2 bindings h3_r2v): hero = 20-25 steps, turbo on for live; inspect the mock's
    // recorded job body via mockRequests() (../mock-comfy/control.ts).
    await page.goto("/motion");
  });

  test.fixme("job stuck in unknown hits the client deadline with a clear message", async ({ page }) => {
    // TODO(wave2): scenario unknown_forever; shorten the deadline via a test hook; never resubmits.
    await setMockScenario({ scenario: "unknown_forever" });
    await page.goto("/motion");
  });
});
