/**
 * Smoke: these must pass today. Landing page renders and links to all four tools, each tool
 * route renders, and the generic /smoke job runner round-trips a real upload through the mock.
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { SURFACES } from "../../lib/brand.ts";
import { mockRequests, resetMock } from "../mock-comfy/control.ts";

const TOOLS = [
  { href: "/identity", name: /identity/i },
  { href: "/photoshoot", name: /product shoot/i },
  { href: "/listing", name: /listing/i },
  { href: "/motion", name: /motion/i },
] as const;

test.beforeEach(async () => {
  await resetMock();
});

test("the page declares an icon that loads, so the browser's favicon request is not a 404", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="icon"]').first().getAttribute("href", { timeout: 5_000 });
  expect(href).toBeTruthy();
  const icon = await page.request.get(href!);
  expect(icon.status()).toBe(200);
});

test("landing page renders and links to the 4 tools", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Open Frame Studio/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const main = page.getByRole("main");
  for (const tool of TOOLS) {
    const link = main.locator(`a[href="${tool.href}"]`).first();
    await expect(link, `landing links to ${tool.href}`).toBeVisible();
    await expect(link).toHaveText(tool.name);
  }
});

for (const tool of TOOLS) {
  test(`landing link navigates to ${tool.href}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").locator(`a[href="${tool.href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${tool.href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(tool.name);
  });
}

test("/smoke runs image_resize_smoke end to end against the mock", async ({ page }) => {
  await page.goto("/smoke");
  await page.locator('input[type="file"]').setInputFiles(join(process.cwd(), "fixtures/products/product-box-checker.png"));
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("status")).toHaveText("Done.", { timeout: 30_000 });
  const output = page.locator("form img").first();
  await expect(output).toBeVisible();
  // Re-hosted through our own route, never a signed/mock URL.
  await expect(output).toHaveAttribute("src", /^\/api\/jobs\/[^/]+\/outputs\/[^/]+$/);
  // Submitted exactly once (never auto-retried); the input is uploaded at most once (hash dedup may skip it).
  const seen = await mockRequests();
  expect(seen.jobPosts).toHaveLength(1);
  expect(seen.assetPosts).toBeLessThanOrEqual(1);
});

test("below md the rail still links to /runs and shows the backend indicator", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const rail = page.locator("aside");
  await expect(rail.getByRole("link", { name: "Recent runs" })).toBeVisible();
  await expect(rail.getByText(/Comfy backend|Demo · local mock/)).toBeVisible();
  // The wrapped rail must not push the page wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("/runs empty state names exactly the tools that record runs there", async ({ page }) => {
  // useRun stores an id for photoshoot, listing and motion; identity's preview only polls a given id.
  await page.goto("/runs");
  const empty = page.getByRole("main").getByText(/^No runs in this tab yet\./);
  await expect(empty).toHaveText(
    `No runs in this tab yet. Start one from ${SURFACES.photoshoot.label}, ${SURFACES.listing.label} or ${SURFACES.motion.label}.`,
  );
});
