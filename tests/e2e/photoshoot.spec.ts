/**
 * Product Shoot: 10 modes, <=4-question interview, 1-10 varied outputs, aspect whitelist.
 * Spec: docs/spec/photoshoot.md. Product fixtures: fixtures/products/*.png (procedural).
 */
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockRequests, resetMock, setMockScenario } from "../mock-comfy/control.ts";

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

const SHOTS = process.env.PHOTOSHOOT_SHOTS_DIR;

async function shootCarousel(page: Page) {
  await page.goto("/photoshoot");
  await page.getByTestId("product-input").setInputFiles(PRODUCT);
  await page.getByRole("button", { name: "Social carousel" }).click();
  await page.getByRole("button", { name: "Shoot 4 slides" }).click();
}

test.describe("Photoshoot studio", () => {
  test("carousel: slide labels, progress, slate restored after reload, no texty prompts", async ({ page }) => {
    await shootCarousel(page);
    await expect(page.getByTestId("run-progress")).toHaveText(/5 of 5 jobs done/, { timeout: 45_000 });
    await expect(page.getByTestId("frame-0")).toContainText("Slide 01");
    await expect(page.getByTestId("frame-3")).toContainText("Slide 04");

    // Every carousel prompt asks for a clean frame, never a title / hook / CTA.
    const prompts = (await mockRequests()).jobPosts.map((post) => JSON.stringify(post.body));
    expect(prompts).toHaveLength(5);
    for (const prompt of prompts.slice(1)) {
      expect(prompt).toContain("no text, no letters, no logos");
      expect(prompt).not.toMatch(/hook|title|call-to-action|Slide \d role/i);
    }

    // Reload: the slate matches the recovered run instead of resetting to defaults.
    await page.reload();
    await expect(page.getByTestId("run-progress")).toHaveText(/5 of 5 jobs done/);
    await expect(page.getByRole("button", { name: "Social carousel" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Shoot 4 slides" })).toBeDisabled();
    await expect(page.getByTestId("readd-product")).toContainText("Add the photo again to shoot.");
    await expect(page.getByAltText("Product from this run")).toBeVisible();
    await expect(page.getByText("5 jobs · cutout + 4")).toBeVisible();
    if (SHOTS) {
      await expect(page.getByTestId("frame-3").locator("img")).toHaveJSProperty("complete", true);
      await page.screenshot({ path: join(SHOTS, "carousel-after-reload.png"), fullPage: true });
    }
  });

  test("upscale 2x: one job through /api/jobs, shows size and a download", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shootCarousel(page);
    await expect(page.getByTestId("run-progress")).toHaveText(/5 of 5 jobs done/, { timeout: 45_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "carousel-finished.png"), fullPage: true });

    const frame = page.getByTestId("frame-0");
    await frame.getByRole("button", { name: "Upscale 2×" }).click();
    await expect(frame.getByTestId("upscale-result")).toContainText(/Upscaled 2× · \d+×\d+/, { timeout: 30_000 });
    const download = frame.getByRole("link", { name: "Download 2×" });
    await expect(download).toHaveAttribute("href", /^\/api\/jobs\/upscale\./);
    await expect(frame.locator("img")).toHaveAttribute("src", /^\/api\/jobs\/upscale\./);
    // Exactly one extra (billed) job, and it is the upscale graph fed the frame's bytes.
    const posts = (await mockRequests()).jobPosts;
    expect(posts).toHaveLength(6);
    expect(posts[5].assetIds).toHaveLength(1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "carousel-upscaled.png"), fullPage: true });
  });

  test("narrow 4-up frames keep the label on one line while waiting for a GPU", async ({ page }) => {
    test.setTimeout(90_000);
    // Every job sits queued for 15 s: first the cutout, then the slides.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 15_000 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await shootCarousel(page);
    const frame = page.getByTestId("frame-0");
    await expect(frame.locator("[data-status=queued]")).toBeVisible({ timeout: 50_000 });
    const label = frame.getByText("Slide 01", { exact: true });
    const box = await label.boundingBox();
    const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(box!.height).toBeLessThan(lineHeight * 1.5);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "carousel-waiting-gpu.png"), fullPage: true });
    await page.getByRole("button", { name: "Cancel run" }).click();
  });
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
