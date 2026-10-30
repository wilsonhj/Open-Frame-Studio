/**
 * Listing Images: scopes hero (1) | gallery (hero+5) | story (hero+7) | complete (13).
 * Main image: pure white background, product ~85% of frame, no text. Gallery / story are anchored
 * on the main image. Spec: docs/spec/listing.md.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockRequests, resetMock } from "../mock-comfy/control.ts";
import type { JobPost } from "../mock-comfy/server.ts";

// Already a cutout (real alpha): the mock's cutout job echoes its input, so this is the hero input that passes A4.
const HERO = join(process.cwd(), "fixtures/products/product-bottle-transparent.png");
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

  test("main image: cutout -> white composite passes compliance", async ({ page }) => {
    // The mock cannot remove a background: its cutout job echoes the input. So the hero input is
    // a photo that is already a cutout (real alpha), which is what passes A4 here.
    await page.goto("/listing");
    await page.locator('input[type="file"]').setInputFiles(HERO);
    await page.getByRole("button", { name: "Generate main image" }).click();

    const hero = page.locator('[data-asset="hero"]');
    await expect(hero.getByText("compliant", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(hero.getByText("not compliant")).toHaveCount(0);
    // Every check (A1–A7, C3) ran on the written file and passed; no failure alert.
    const checks = hero.getByTestId("main-checks").locator("li");
    await expect(checks).toHaveCount(8);
    await expect(hero.getByTestId("main-checks").getByLabel("pass")).toHaveCount(8);
    for (const id of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "C3"]) {
      await expect(checks.filter({ hasText: id })).toHaveCount(1);
    }
    await expect(hero.getByRole("alert")).toHaveCount(0);
    await expect(hero.getByRole("img", { name: "Main image" })).toHaveAttribute("src", /01_hero\.png/);
    await expect(hero.getByRole("link", { name: "Download" })).toBeVisible();
    // One job: the cutout of the uploaded photo.
    expect((await mockRequests()).jobPosts).toHaveLength(1);
  });

  test("secondary + story tiles are submitted with the main image as anchor", async ({ page }) => {
    test.setTimeout(120_000);
    // Default scenario, not multi_output: multi_output always labels its images node "9", but the
    // Klein t2i graph saves from node "p9" (lib/bindings/klein_t2i.ts), so under that scenario the two
    // t2i panels fail with "No output image[0]". That is a mock fidelity gap, not an app bug.
    await startRun(page, "Complete set · 13");
    await expectAllPanelsDone(page, 13);

    const posts = (await mockRequests()).jobPosts;
    const [cutout, ...rest] = posts;
    expect(cutout.assetIds).toHaveLength(1); // the uploaded photo
    const anchor = `out-${cutout.jobId}`;
    const text = (p: JobPost) => JSON.stringify(p.body);
    const edits = rest.filter((p) => text(p).includes("from image 1"));
    const t2i = rest.filter((p) => !text(p).includes("from image 1") && !text(p).includes("oss_upscale"));
    const upscales = rest.filter((p) => text(p).includes("oss_upscale"));
    // Klein edit: angles x3, detail, in use, contents, story banner. All load the hero cutout as image 1.
    expect(edits).toHaveLength(7);
    for (const p of edits) expect(p.assetIds).toEqual([anchor]);
    // Klein t2i (problem/solution mood image, materials still life) has no product by design (spec §4.2).
    expect(t2i).toHaveLength(2);
    for (const p of t2i) expect(p.assetIds).toEqual([]);
    // Upscales (detail, in use, contents) refine their own generation, never the raw upload.
    expect(upscales).toHaveLength(3);
    const editIds = new Set(edits.map((p) => `out-${p.jobId}`));
    for (const p of upscales) {
      expect(p.assetIds).toHaveLength(1);
      expect(editIds.has(p.assetIds[0])).toBe(true);
    }
  });

  test("per-tile regenerate submits exactly one new job for that tile", async ({ page }) => {
    test.setTimeout(120_000);
    await startRun(page, "Story · 8");
    await expectAllPanelsDone(page, 8);
    const before = (await mockRequests()).jobPosts;
    const seeds = await tileSeeds(page);

    // Story banner is one Klein edit (no upscale), so a new seed is exactly one billed job.
    const banner = page.locator('[data-asset="story_banner"]');
    await banner.getByRole("button", { name: "Regenerate Story banner" }).click();
    await expect.poll(async () => (await mockRequests()).jobPosts.length).toBe(before.length + 1);
    await expect.poll(async () => (await tileSeeds(page)).story_banner).not.toBe(seeds.story_banner);
    await expectAllPanelsDone(page, 8);

    const after = (await mockRequests()).jobPosts;
    expect(after).toHaveLength(before.length + 1);
    const job = after.at(-1)!;
    expect(JSON.stringify(job.body)).toContain("Wide styled");
    expect(job.assetIds).toEqual([`out-${before[0].jobId}`]); // same anchor as the first run
    // Every other tile keeps its seed.
    const now = await tileSeeds(page);
    for (const [asset, seed] of Object.entries(seeds)) {
      if (asset !== "story_banner") expect(now[asset], asset).toBe(seed);
    }
  });

  test("ZIP export downloads all finished tiles", async ({ page }) => {
    test.setTimeout(120_000);
    await startRun(page, "Gallery · 6");
    await expectAllPanelsDone(page, 6);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download ZIP" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^listing-.+\.zip$/);
    const zip = await readFile(await download.path());
    const names = zipEntryNames(zip).sort();
    expect(names).toEqual([
      "01_hero.png",
      "02_gallery_callouts.png",
      "03_gallery_angles.jpg",
      "04_gallery_detail.jpg",
      "05_gallery_in_use.jpg",
      "06_gallery_contents.jpg",
      "cards.json",
    ].sort());
  });
});

/** Panel copy short enough to fit every card, so no tile ends in needs_input or text_too_long. */
async function startRun(page: Page, scope: keyof typeof SCOPE_COUNTS) {
  await page.goto("/listing");
  await page.getByRole("button", { name: scope }).click();
  const copy = page.getByTestId("listing-copy");
  await copy.getByRole("textbox", { name: /^Product name/ }).fill("Glass bottle");
  await copy.getByRole("textbox", { name: /^Benefits/ }).fill("Keeps cold\nLeak proof\nDishwasher safe");
  await copy.getByRole("textbox", { name: /^Specs/ }).fill("Volume: 500 ml");
  await copy.getByRole("textbox", { name: /^In the box/ }).fill("1 × Lid");
  await copy.getByRole("textbox", { name: /^Problems it solves/ }).fill("Warm water → Cold for 24 h\nLeaky bag → Sealed lid");
  await copy.getByRole("textbox", { name: /^Results/ }).fill("92% stayed cold\n8 of 10 kept it");
  await copy.getByRole("textbox", { name: /^Source of the results/ }).fill("In-house test, 2026");
  await copy.getByRole("textbox", { name: /^How to use/ }).fill("Fill\nClose\nGo");
  await copy.locator("textarea").last().fill("Best bottle I own.");
  await copy.getByPlaceholder("Who said it").fill("A. Buyer");
  await copy.locator('input[type="checkbox"]').first().check();
  await page.locator('input[type="file"]').setInputFiles(HERO);
  await page.getByRole("button", { name: `Generate ${SCOPE_COUNTS[scope]} images` }).click();
}

/** The hero is compliant and every tile (hero + panels) shows "succeeded". */
async function expectAllPanelsDone(page: Page, count: number) {
  await expect(page.locator('[data-asset="hero"]').getByText("compliant", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("succeeded", { exact: true })).toHaveCount(count, { timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Download ZIP" })).toBeVisible();
}

async function tileSeeds(page: Page): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const tile of await page.locator("[data-asset]").all()) {
    const asset = (await tile.getAttribute("data-asset"))!;
    out[asset] = (await tile.innerText()).match(/seed (\d+)/)?.[1] ?? null;
  }
  return out;
}

/** File names from a ZIP's central directory (signature 0x02014b50). */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (let i = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 46)) {
    const len = zip.readUInt16LE(i + 28);
    names.push(zip.subarray(i + 46, i + 46 + len).toString("utf8"));
  }
  return names;
}
