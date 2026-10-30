/**
 * Unfinished-job recovery across tabs (lib/job-recovery.ts): one tab finishing
 * its job must not erase another tab's unfinished run, and a reloaded tab
 * resumes its own run.
 */
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockRequests, resetMock, setMockScenario } from "../mock-comfy/control.ts";

const IMAGE = join(process.cwd(), "fixtures/products/product-box-checker.png");
const PREFIX = "studio:unfinished-job:";

test.beforeEach(async () => {
  await resetMock();
});

async function submit(page: Page) {
  await page.goto("/smoke");
  await page.locator('input[type="file"]').setInputFiles(IMAGE);
  await page.getByRole("button", { name: "Run" }).click();
}

const savedRuns = (page: Page) =>
  page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), PREFIX);

test("two tabs: A finishing doesn't erase B's unfinished run, and B resumes it after reload", async ({ context }) => {
  // Tab B: a job that never finishes (a proxy stuck in `unknown`).
  await setMockScenario({ scenario: "unknown_forever" });
  const tabB = await context.newPage();
  await submit(tabB);
  await expect(tabB.getByRole("button", { name: "Working…" })).toBeVisible();
  await expect.poll(() => savedRuns(tabB)).toHaveLength(1);
  const [runB] = await savedRuns(tabB);

  // Tab A, opened while B is still watching: it must not adopt B's run, and its own job finishes.
  await setMockScenario({ scenario: "succeeded" });
  const tabA = await context.newPage();
  await submit(tabA);
  await expect(tabA.getByRole("status")).toHaveText("Done.", { timeout: 30_000 });

  // A's finished job left no entry; B's unfinished one is still there.
  expect(await savedRuns(tabA)).toEqual([runB]);

  // Reloading B resumes its own run instead of offering a second paid submit.
  await tabB.reload();
  await expect(tabB.getByRole("button", { name: "Working…" })).toBeVisible();
  await expect(tabB.getByRole("button", { name: "Run" })).toHaveCount(0);
  expect((await mockRequests()).jobPosts).toHaveLength(2);
});
