/**
 * Listing Images: scopes hero (1) | gallery (hero+5) | story (hero+7) | complete (13).
 * Main image: pure white background, product ~85% of frame, no text. Gallery / story are anchored
 * on the main image. Spec: docs/spec/listing.md.
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { resetMock, setMockScenario } from "../mock-comfy/control.ts";

const PRODUCT = join(process.cwd(), "fixtures/products/product-mug-tiles.png");
const SCOPE_COUNTS = { "Hero only": 1, "Gallery · 6": 6, "Story · 8": 8, "Complete set · 13": 13 } as const;

test.beforeEach(async () => {
  await resetMock();
});

test("Listing Images page renders", async ({ page }) => {
  await page.goto("/listing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/listing images/i);
});

test.describe("Cards board", () => {
  test("scope picker sets the tile count and asks for panel copy", async ({ page }) => {
    await page.goto("/listing");
    for (const [label, count] of Object.entries(SCOPE_COUNTS)) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-asset]")).toHaveCount(count);
      // The hero never carries text; every other scope shows the copy form.
      await expect(page.getByTestId("listing-copy")).toHaveCount(count === 1 ? 0 : 1);
    }
    await page.getByRole("button", { name: "Gallery · 6" }).click();
    for (const asset of ["hero", "gallery_callouts", "gallery_angles", "gallery_detail", "gallery_in_use", "gallery_contents"]) {
      await expect(page.locator(`[data-asset="${asset}"]`)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Generate 6 images/ })).toBeVisible();
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
