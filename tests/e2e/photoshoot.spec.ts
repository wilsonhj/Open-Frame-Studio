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

  test("upscale 2x survives a reload: the same job resumes, nothing is billed twice", async ({ page }) => {
    await shootCarousel(page);
    await expect(page.getByTestId("run-progress")).toHaveText(/5 of 5 jobs done/, { timeout: 45_000 });
    await setMockScenario({ scenario: "slow_progress" });
    const frame = page.getByTestId("frame-0");
    await frame.getByRole("button", { name: "Upscale 2×" }).click();
    await expect(frame.getByRole("button", { name: "Upscaling…" })).toBeVisible();
    await expect.poll(async () => (await mockRequests()).jobPosts.length).toBe(6);

    await page.reload();
    // The paid job is still tracked: no fresh "Upscale 2×" offer, and it finishes.
    await expect(frame.getByRole("button", { name: "Upscaling…" })).toBeVisible();
    await expect(frame.getByTestId("upscale-result")).toContainText(/Upscaled 2×/, { timeout: 45_000 });
    expect((await mockRequests()).jobPosts).toHaveLength(6);

    // A finished upscale is still shown after another reload.
    await page.reload();
    await expect(frame.getByTestId("upscale-result")).toContainText(/Upscaled 2×/);
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

/** The assembled enhancer prompt in a submitted Klein job (the cutout job has none). */
function shotPrompt(body: unknown): string | null {
  if (typeof body === "string") return body.includes("the product from image 1") ? body : null;
  if (body && typeof body === "object") {
    for (const value of Object.values(body)) {
      const found = shotPrompt(value);
      if (found) return found;
    }
  }
  return null;
}

async function shotPrompts(): Promise<string[]> {
  const { jobPosts } = await mockRequests();
  return jobPosts.map((post) => shotPrompt(post.body)).filter((p): p is string => p !== null);
}

test.describe("Photoshoot dock", () => {
  test.fixme("mode rail lists all 10 modes and the aspect picker only offers the whitelist", async ({ page }) => {
    // Not built (observed on main): the Mode field offers the 5 demo modes only (DEMO_MODES in
    // lib/enhancer/modes.ts: packshot, in_context, wide_banner, mood_still, carousel_set) and the
    // slate has no aspect picker; the aspect follows the mode (ux.md §5 item 6 asks for whitelist chips).
    // TODO(wave2 frontend: Photoshoot dock): one control per mode in MODES; aspect options equal ASPECTS;
    // mood_still defaults to 2:3, wide_banner to a >=16:9 aspect.
    await page.goto("/photoshoot");
    expect(MODES).toHaveLength(10);
    expect(ASPECTS).toHaveLength(9);
  });

  test.fixme("interview asks at most 4 questions with chip answers", async ({ page }) => {
    // Not built (observed on main): /photoshoot has no free-text request box, no mode router call
    // and no interview chip sheet (photoshoot.md §5); the user picks the mode directly.
    // TODO(wave2 frontend + enhancer router): free-text request routes to a mode; interview shows
    // <=4 questions, each answerable by a labelled chip; skipping keeps defaults.
    await page.goto("/photoshoot");
  });

  test("packshot x4: upload product, generate, gallery shows 4 varied images", async ({ page }) => {
    await page.goto("/photoshoot");
    await page.getByTestId("product-input").setInputFiles(PRODUCT);
    await page.getByRole("button", { name: "Product shot" }).click();
    await page.getByRole("button", { name: "4", exact: true }).click();
    await expect(page.getByText("5 jobs · cutout + 4 × 1:1 frames")).toBeVisible();
    await page.getByRole("button", { name: "Shoot 4", exact: true }).click();
    // The mock fixes the scenario per job at submit. multi_output answers with fixed node ids
    // (images on "9", a video on "12"), so the cutout job, whose output is read by node id, keeps
    // the default scenario; every shot job then returns two images and a video.
    await expect.poll(async () => (await mockRequests()).jobPosts.length).toBe(1);
    await setMockScenario({ scenario: "multi_output" });
    await expect(page.getByTestId("run-progress")).toHaveText(/5 of 5 jobs done/, { timeout: 45_000 });

    const sheet = page.getByRole("region", { name: "Contact sheet" });
    await expect(sheet.locator("figure")).toHaveCount(4);
    await expect(sheet.locator("video")).toHaveCount(0);
    const picks: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const frame = page.getByTestId(`frame-${i}`);
      // Outputs are re-hosted by the run (never a Comfy URL), one image file per shot step.
      await expect(frame.locator("img")).toHaveAttribute("src", new RegExp(`^/api/pipelines/photoshoot/[^/]+/files/shot-${i}/\\d+\\.png$`));
      const titles = await frame.locator("figcaption span[title]").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("title") ?? ""),
      );
      const caption = titles.find((title) => title.split(" · ").length === 4);
      if (!caption) throw new Error(`frame ${i} has no 4-part variation title`);
      picks.push(caption.split(" · "));
    }

    // One cutout + 4 Klein jobs. Shots are posted in parallel, so pair each
    // frame's variation to the prompt that contains it, not by submit order.
    expect((await mockRequests()).jobPosts).toHaveLength(5);
    const prompts = await shotPrompts();
    expect(prompts).toHaveLength(4);
    const matched = picks.map((pick) => {
      expect(pick).toHaveLength(4); // preset · lighting · angle · palette
      return prompts.findIndex((prompt) => pick.every((value) => prompt.toLowerCase().includes(value.toLowerCase())));
    });
    expect(matched.every((index) => index >= 0)).toBe(true);
    expect(new Set(matched).size).toBe(4);
    // ...and the four differ on every axis (photoshoot.md §6).
    for (let axis = 0; axis < 4; axis++) {
      expect(new Set(picks.map((pick) => pick[axis])).size).toBe(4);
    }
  });

  // photoshoot.md §2 allows 3–10 slides; the demo caps every mode at MAX_OUTPUTS = 4
  // (lib/enhancer/modes.ts), so the only count chips are 3 and 4. Both are covered here.
  for (const slides of [3, 4]) {
    test(`carousel_set shares one style block across ${slides} slides`, async ({ page }) => {
      await page.goto("/photoshoot");
      await page.getByTestId("product-input").setInputFiles(PRODUCT);
      await page.getByRole("button", { name: "Social carousel" }).click();
      await page.getByRole("button", { name: String(slides), exact: true }).click();
      await page.getByRole("button", { name: `Shoot ${slides} slides` }).click();
      await expect(page.getByTestId("run-progress")).toHaveText(new RegExp(`${slides + 1} of ${slides + 1} jobs done`), {
        timeout: 45_000,
      });
      await expect(page.getByText("🔒 style lock")).toBeVisible();

      const prompts = await shotPrompts();
      expect(prompts).toHaveLength(slides);
      // One shared style block is prepended to every prompt (photoshoot.md §6)...
      const blocks = prompts.map((p) => p.match(/^Shared visual system for every slide: [^.]+\./)?.[0]);
      expect(blocks[0]).toBeTruthy();
      for (const block of blocks) expect(block).toBe(blocks[0]);
      // ...while the slides themselves differ (role / angle).
      expect(new Set(prompts).size).toBe(slides);
    });
  }

  test("long job: queued then progress, cancel is not offered as a retry", async ({ page }) => {
    test.setTimeout(90_000);
    // The cutout job waits for a GPU (queued_20s, shortened); the shot job then runs under
    // slow_progress (one queued poll, then 10 running polls), long enough to cancel mid-run.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 6_000 });
    await page.goto("/photoshoot");
    await page.getByTestId("product-input").setInputFiles(PRODUCT);
    await page.getByRole("button", { name: "Product shot" }).click();
    await page.getByRole("button", { name: "Shoot 1", exact: true }).click();
    await expect.poll(async () => (await mockRequests()).jobPosts.length).toBe(1);
    await setMockScenario({ scenario: "slow_progress" });

    const frame = page.getByTestId("frame-0");
    const progress = page.getByRole("progressbar", { name: "Run progress" });
    // Queued: the cutout waits for a GPU, the frame waits on the cutout, nothing is done yet.
    await expect(page.getByText("cutout · queued")).toBeVisible({ timeout: 15_000 });
    await expect(frame).toContainText("after cutout");
    await expect(progress).toHaveAttribute("aria-valuenow", "0");
    // Then progress: the cutout is done and the frame is developing.
    await expect(frame.locator("[data-status=running]")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("run-progress")).toHaveText(/1 of 2 jobs done/);
    await expect(progress).toHaveAttribute("aria-valuenow", "1");

    // While the run is live the only action is Cancel run: no Retry is offered.
    await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
    const posts = (await mockRequests()).jobPosts.length;
    expect(posts).toBe(2);

    await page.getByRole("button", { name: "Cancel run" }).click();
    await expect(frame.locator("[data-status=canceled]")).toBeVisible({ timeout: 20_000 });
    // Cancel never resubmits: no new job. Retry is a separate, explicit action that names its cost.
    await expect(frame.getByRole("button", { name: "Retry · 1 job" })).toBeVisible();
    expect((await mockRequests()).jobPosts).toHaveLength(posts);
    await expect(page.getByRole("button", { name: "Shoot 1", exact: true })).toBeEnabled();
  });
});
