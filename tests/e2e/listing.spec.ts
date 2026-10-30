/**
 * Listing Images: scopes main | product-images (main+5) | aplus (main+7) | full-set (13).
 * Main image: pure white background, product ~85% of frame, no text. Gallery / story are anchored
 * on the main image. Spec: docs/spec/listing.md.
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { resetMock, setMockScenario } from "../mock-comfy/control.ts";

const PRODUCT = join(process.cwd(), "fixtures/products/product-mug-tiles.png");
const SCOPE_COUNTS = { main: 1, "gallery": 6, aplus: 8, "complete": 13 } as const;

test.beforeEach(async () => {
  await resetMock();
});

test("Listing Images page renders", async ({ page }) => {
  await page.goto("/listing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/listing images/i);
});

test.describe("Cards board", () => {
  test.fixme("scope picker sets the tile count", async ({ page }) => {
    // TODO(wave2 frontend: Cards board): for each scope in SCOPE_COUNTS the grid shows that many
    // placeholder tiles with asset names (hero, infographic, gallery_angles, ..., aplus_*).
    await page.goto("/listing");
    void SCOPE_COUNTS;
  });

  test.fixme("main image: cutout -> white composite passes compliance", async ({ page }) => {
    // TODO(wave2 lib/cards compliance): upload PRODUCT (busy background on purpose); the main tile
    // shows a compliance badge: border pixels >=99% #FFFFFF, product bbox >=80% of frame, no text.
    // Mock outputs are 1x1 PNGs, so assert the badge/state, not pixels, in this mock-backed test.
    await page.goto("/listing");
    void PRODUCT;
  });

  test.fixme("secondary + story tiles are submitted with the main image as anchor", async ({ page }) => {
    // TODO(wave2 pipeline): full-set run; every non-main job body references the main output
    // (main-job anchoring). Uses multi_output to exercise mixed outputs on one job.
    await setMockScenario({ scenario: "multi_output" });
    await page.goto("/listing");
  });

  test.fixme("per-tile regenerate submits exactly one new job for that tile", async ({ page }) => {
    // TODO(wave2): click regenerate on one tile -> mockRequests().jobPosts grows by one; others untouched.
    await page.goto("/listing");
  });

  test.fixme("ZIP export downloads all finished tiles", async ({ page }) => {
    // TODO(wave2): page.waitForEvent("download"); zip contains one file per finished asset.
    await page.goto("/listing");
  });
});
