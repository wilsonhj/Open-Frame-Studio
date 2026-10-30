/**
 * Listing Images: scopes hero (1) | gallery (hero+5) | story (hero+7) | complete (13).
 * Main image: pure white background, product ~85% of frame, no text. Gallery / story are anchored
 * on the product cutout. Spec: docs/spec/listing.md.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { unzipStore } from "../../lib/cards/zip.ts";
import { mockRequests, resetMock, setMockScenario } from "../mock-comfy/control.ts";
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
    const byKind = groupJobs(posts);
    expect(posts).toHaveLength(13);
    expect(byKind.cutout).toHaveLength(1);
    expect(byKind.edit).toHaveLength(7);
    expect(byKind.t2i).toHaveLength(2);
    expect(byKind.upscale).toHaveLength(3);
    const cutout = byKind.cutout[0];
    expect(cutout.assetIds).toHaveLength(1); // the uploaded photo
    const anchor = `out-${cutout.jobId}`;
    // Klein edit: angles x3, detail, in use, contents, story banner. All load the hero cutout as image 1.
    for (const p of byKind.edit) {
      expect(JSON.stringify(p.body)).toContain("from image 1");
      expect(p.assetIds).toEqual([anchor]);
    }
    // Klein t2i (problem/solution mood image, materials still life) has no product by design (spec §4.2).
    for (const p of byKind.t2i) expect(p.assetIds).toEqual([]);
    // Each upscale refines its own generation, never the raw upload or a shared edit.
    const editIds = new Set(byKind.edit.map((p) => `out-${p.jobId}`));
    const upInputs = byKind.upscale.map((p) => p.assetIds[0]);
    expect(new Set(upInputs).size).toBe(3);
    for (const id of upInputs) expect(editIds.has(id)).toBe(true);
    // Detail, in use, and contents — not three copies of one edit.
    const editText = new Map(byKind.edit.map((p) => [`out-${p.jobId}`, JSON.stringify(p.body)]));
    const refined = upInputs.map((id) => editText.get(id) ?? "");
    for (const marker of ["showing its Volume", "in use in a believable", "together with 1"]) {
      expect(refined.some((text) => text.includes(marker)), marker).toBe(true);
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
    expect(jobKind(job)).toBe("edit");
    expect(JSON.stringify(job.body)).toContain("Wide styled");
    const cutout = before.find((p) => jobKind(p) === "cutout");
    if (!cutout) throw new Error("cutout job missing");
    expect(job.assetIds).toEqual([`out-${cutout.jobId}`]); // same anchor as the first run
    // Every other tile keeps its seed.
    const now = await tileSeeds(page);
    expect(seeds.story_banner).toMatch(/^\d+$/);
    const kept = Object.entries(seeds).filter(([asset]) => asset !== "hero" && asset !== "story_banner");
    expect(kept.some(([, seed]) => seed !== null)).toBe(true);
    for (const [asset, seed] of kept) expect(now[asset], asset).toBe(seed);
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
    const entries = unzipStore(new Uint8Array(zip));
    const names = Object.keys(entries).sort();
    const images = [
      "01_hero.png",
      "02_gallery_callouts.png",
      "03_gallery_angles.jpg",
      "04_gallery_detail.jpg",
      "05_gallery_in_use.jpg",
      "06_gallery_contents.jpg",
    ];
    expect(names).toEqual([...images, "cards.json"].sort());
    for (const name of images) {
      const bytes = entries[name];
      expect(bytes.byteLength, name).toBeGreaterThan(32);
      const magic = name.endsWith(".png") ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8];
      expect([...bytes.subarray(0, magic.length)], name).toEqual(magic);
    }
    const manifest = JSON.parse(new TextDecoder().decode(entries["cards.json"])) as {
      anchorJobId: string | null;
      tiles: { state: string; file: string | null }[];
    };
    expect(manifest.anchorJobId).toEqual(expect.any(String));
    expect(manifest.tiles.filter((t) => t.state === "succeeded").map((t) => t.file).sort()).toEqual([...images].sort());
  });

  test("a live run can be canceled from the board", async ({ page }) => {
    // Jobs stay queued long enough to cancel while the cutout is live.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 60_000 });
    await startRun(page, "Story · 8");
    const hero = page.locator('[data-asset="hero"]');
    await expect(hero.locator("[data-status]").first()).toHaveAttribute("data-status", /queued|running/);

    await page.getByRole("button", { name: "Cancel run" }).click();
    await expect(hero.locator("[data-status]").first()).toHaveAttribute("data-status", "canceled", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
    const runId = await page.evaluate(() => sessionStorage.getItem("oss:run:listing"));
    const run = (await (await page.request.get(`/api/pipelines/listing/${runId}`)).json()) as { status: string };
    expect(run.status).toBe("canceled");
    // Cancel never resubmits: only the cutout was ever sent.
    expect((await mockRequests()).jobPosts).toHaveLength(1);
  });

  test("a failed cancel is reported and the run can still be canceled", async ({ page }) => {
    await setMockScenario({ scenario: "queued_20s", queuedMs: 60_000 });
    await startRun(page, "Story · 8");
    const cancel = page.getByRole("button", { name: "Cancel run" });
    await expect(cancel).toBeVisible();

    await page.route("**/cancel", (route) => route.abort());
    await cancel.click();
    const failed = page.getByText("Could not cancel the run");
    await expect(failed).toBeVisible();
    // The next status poll clears the hook's own error text; this message must outlive it.
    await page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/pipelines\/listing\/[^/]+$/.test(r.url()));
    await expect(failed).toBeVisible();
    await expect(cancel).toBeVisible();

    await page.unroute("**/cancel");
    await cancel.click();
    await expect(page.locator('[data-asset="hero"] [data-status]').first()).toHaveAttribute("data-status", "canceled", { timeout: 20_000 });
    await expect(failed).toHaveCount(0);
  });

  test("a canceled run keeps its finished tiles exportable", async ({ page }) => {
    test.setTimeout(120_000);
    await startRun(page, "Story · 8");
    await expectAllPanelsDone(page, 8);
    // Regenerate one tile with a job that stays queued, then cancel the run while it waits.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 60_000 });
    const banner = page.locator('[data-asset="story_banner"]');
    await banner.getByRole("button", { name: "Regenerate Story banner" }).click();
    await expect(banner.locator("[data-status]").first()).toHaveAttribute("data-status", /queued|running/);
    const runId = await page.evaluate(() => sessionStorage.getItem("oss:run:listing"));
    expect((await page.request.post(`/api/pipelines/listing/${runId}/cancel`)).status()).toBe(200);

    await expect(banner.locator("[data-status]").first()).toHaveAttribute("data-status", "canceled", { timeout: 20_000 });
    await expect(banner).toContainText("Canceled");
    await expect(banner).not.toContainText("Working…");
    // The seven other tiles are done: they can still be downloaded, and the canceled one made again.
    await expect(page.getByRole("link", { name: "Download ZIP" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Regenerate Story banner" })).toBeVisible();
  });

  test("reopening a run with ?run= shows the scope it was made with", async ({ page, context }) => {
    await startRun(page, "Story · 8");
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("oss:run:listing"))).not.toBeNull();
    const runId = await page.evaluate(() => sessionStorage.getItem("oss:run:listing"));

    // A new tab has no remembered run or scope pick: only the deep link says which run this is.
    const reopened = await context.newPage();
    await reopened.goto(`/listing?run=${runId}`);
    await expect(reopened.locator("[data-asset]")).toHaveCount(8);
    await expect(reopened.getByRole("button", { name: "Story · 8" })).toHaveAttribute("aria-pressed", "true");
    await expect(reopened.getByRole("button", { name: "Hero only" })).toHaveAttribute("aria-pressed", "false");
    await expect(reopened.getByRole("button", { name: "Generate 8 images" })).toBeVisible();
    await expect(reopened.getByRole("button", { name: "Generate main image" })).toHaveCount(0);
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

/** The hero is compliant and every tile's own status pill has reached "succeeded". */
async function expectAllPanelsDone(page: Page, count: number) {
  const tiles = page.locator("[data-asset]");
  await expect(tiles).toHaveCount(count);
  await expect(async () => {
    expect(await tiles.count()).toBe(count);
    for (let i = 0; i < count; i++) {
      await expect(tiles.nth(i).locator("[data-status]").first()).toHaveAttribute("data-status", "succeeded");
    }
  }).toPass({ timeout: 90_000 });
  await expect(page.locator('[data-asset="hero"]').getByText("compliant", { exact: true })).toBeVisible();
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

type JobKind = "cutout" | "edit" | "t2i" | "upscale";

/** One workflow per job, from the graph's own filename_prefix (not prompt wording). */
function jobKind(post: JobPost): JobKind {
  const text = JSON.stringify(post.body);
  const kinds = (
    [
      ["oss_upscale", "upscale"],
      ["klein_t2i", "t2i"],
      ["klein_multiref", "edit"],
      ["oss_cutout", "cutout"],
    ] as const
  )
    .filter(([prefix]) => text.includes(`"${prefix}"`))
    .map(([, kind]) => kind);
  if (kinds.length !== 1) throw new Error(`expected one workflow prefix, got ${kinds.join(", ") || "none"}`);
  return kinds[0];
}

function groupJobs(posts: JobPost[]): Record<JobKind, JobPost[]> {
  const grouped: Record<JobKind, JobPost[]> = { cutout: [], edit: [], t2i: [], upscale: [] };
  for (const post of posts) grouped[jobKind(post)].push(post);
  return grouped;
}
