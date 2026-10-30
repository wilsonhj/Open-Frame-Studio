/**
 * Identity (Instant): photo QA -> curated 3-6 reference crops + style card -> portable identity.json.
 * Plan: docs/PLAN.md "Update after Wave 0" (no trained LoRA). Spec: docs/spec/identity.md.
 *
 * Fixtures: fixtures/faces/ is intentionally EMPTY in the repo (no real faces). Flows that need a
 * face set read FACES_DIR and skip when absent; see fixtures/README.md.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { mockRequests, resetMock, setMockScenario } from "../mock-comfy/control.ts";

const FACES_DIR = process.env.E2E_FACES_DIR ?? join(process.cwd(), "fixtures/faces");
const faces = existsSync(FACES_DIR) ? readdirSync(FACES_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];

test.beforeEach(async () => {
  await resetMock();
});

test("Identity page renders", async ({ page }) => {
  await page.goto("/identity");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/identity/i);
});

test("likeness consent gates the photo picker", async ({ page }) => {
  await page.goto("/identity");
  const consent = page.locator("form").getByRole("checkbox", { name: /photos of me, or I have this person's permission/i });
  const picker = page.getByLabel(/^Photos/);
  const create = page.getByRole("button", { name: "Create identity" });

  await expect(consent).not.toBeChecked();
  await expect(picker).toBeDisabled();
  await expect(create).toBeDisabled();

  await consent.check();
  await expect(picker).toBeEnabled();
  const product = join(process.cwd(), "fixtures/products/product-box-checker.png");
  await picker.setInputFiles([product, product]);
  await expect(page.getByText("2 selected.", { exact: false })).toBeVisible();

  // Withdrawing consent drops the selection and locks the picker again.
  await consent.uncheck();
  await expect(picker).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText(/photos removed/i);
  await consent.check();
  await expect(page.getByText("0 selected.", { exact: false })).toBeVisible();
});

test.describe("Identity wizard", () => {
  test("server QA rejects photos without one usable face, and nothing reaches Comfy", async ({ page }) => {
    await page.goto("/identity");
    await page.getByLabel("Name").fill("Nobody");
    await page.locator("form").getByRole("checkbox", { name: /photos of me, or I have this person's permission/i }).check();
    const picker = page.getByLabel(/^Photos/);
    const products = ["product-bottle-confetti.png", "product-box-checker.png", "product-mug-tiles.png", "product-bottle-transparent.png"];
    // Fewer than 5: the form will not submit.
    await picker.setInputFiles(products.map((f) => join(process.cwd(), "fixtures/products", f)));
    await expect(page.getByRole("button", { name: "Create identity" })).toBeDisabled();
    // Four product photos plus a text file: the server checks every one, and none has a face.
    await picker.setInputFiles([
      ...products.map((f) => ({ name: f, mimeType: "image/png", buffer: readFileSync(join(process.cwd(), "fixtures/products", f)) })),
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") },
    ]);
    await page.getByRole("button", { name: "Create identity" }).click();
    const report = page.getByTestId("photo-report");
    await expect(report.locator("li")).toHaveCount(5);
    await expect(report.locator('li[data-reason="no_face"]')).toHaveCount(4);
    await expect(report.locator('li[data-reason="unsupported_type"]')).toHaveCount(1);
    await expect(page.getByText("Need at least 3 usable photos.")).toBeVisible();
    // QA runs on this server: no asset upload and no job.
    const requests = await mockRequests();
    expect(requests.assetPosts).toBe(0);
    expect(requests.jobPosts).toHaveLength(0);
  });

  test("instant Identity: upload -> QA -> pick refs -> preview sheet -> save identity.json", async ({ page }) => {
    test.skip(faces.length < 5, `needs >=5 consented/AI face images in ${FACES_DIR}`);
    await setMockScenario({ scenario: "succeeded", queuedMs: 0 });
    await page.goto("/identity");
    await page.getByLabel("Name").fill("Demo");
    await page.locator("form").getByRole("checkbox", { name: /photos of me, or I have this person's permission/i }).check();
    await page.getByLabel(/^Photos/).setInputFiles(faces.slice(0, 8).map((f) => join(FACES_DIR, f)));
    await page.getByRole("button", { name: "Create identity" }).click();
    await expect(page.getByTestId("identity-message")).toHaveText(/Identity Demo ready/, { timeout: 60_000 });
    const refs = page.getByTestId("identity-refs").locator("img");
    expect(await refs.count()).toBeGreaterThanOrEqual(3);
    expect((await mockRequests()).assetPosts).toBe(0);
    await page.getByRole("button", { name: "Render preview sheet" }).click();
    await expect(page.getByAltText("Identity preview sheet")).toBeVisible({ timeout: 60_000 });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download .identity.zip" }).click();
    expect((await download).suggestedFilename()).toBe("demo.identity.zip");
  });

  test.fixme("S-R1: Identity reuse across separate jobs after export/import (docs/spec/identity.md §6.6)", async ({ page }) => {
    test.skip(faces.length < 5, `needs >=5 consented/AI face images in ${FACES_DIR}`);
    // Covered at unit level on the mock (tests/soul/registry.test.ts "S-R1"); this browser
    // version still needs a consented face set and the Photoshoot/Motion identity slots (D, F).
    // Still blocked (checked 2026-10-30):
    // - No faces: fixtures/faces/ is not in the repo, and import re-runs photo QA (§6.5), so no
    //   identity can be created or imported in the browser without E2E_FACES_DIR.
    // - Step 5: Photoshoot ignores identityId ("Identity ignored: product shoots use the product
    //   photo only for now.", lib/photoshoot/pipeline.ts) and its UI has no Identity picker.
    //   Motion (step 6) does have the picker.
    // 1. Create an identity (job A: preview). Each ref has sha256.
    // 2. Export .identity.zip: contains identity.json + refs/ref_N.png; no assetIds or Comfy/mock URLs;
    //    every refs[].sha256 matches its PNG.
    // 3. Cold restart: wipe .data/identities/ and delete the cached assets (or restart the mock).
    // 4. Import the .identity.zip: refs re-uploaded (mockRequests().assetPosts grows by the ref count),
    //    fresh assetIds cached.
    // 5. Photoshoot hands_on, count 2, as separate job(s) B: the Identity slots
    //    (image 1-3) are bound to the imported refs; mockRequests().jobPosts[i].assetIds name them
    //    and the uploaded hashes match refs[].sha256.
    // 6. Motion job C: <Picture 1> (node 137) binds the Identity's refs[0].
    // 7. Stale cache: setMockScenario({ scenario: "asset_missing", missingAssetIds: [<one cached
    //    ref id>] }), run again: the app re-uploads that ref by sha256 and succeeds with exactly one
    //    new job POST and no 4xx/5xx shown to the user.
    // 8. Optional (Cloud sign-off only): the same bundle on a proxy backend.
    // Pass: B and C succeed in separate requests after the restart; bindings and hashes match.
    await page.goto("/identity");
  });

  test.fixme("shows queue wait, then progress, while the preview renders", async ({ page }) => {
    // TODO(wave2 frontend): with scenario queued_20s (queuedMs shortened), UI shows a "waiting for
    // a GPU" state with queue position; then slow_progress shows a rising progress bar.
    // Still blocked (checked 2026-10-30):
    // - Needs an identity first, so >=5 consented/AI faces in FACES_DIR (none in the repo).
    // - PreviewRun (components/soul/identity-studio.tsx) shows only a StatusPill ("queued" /
    //   run status). It renders no queue position and no progress bar, though run.progress exists.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 3_000 });
    await page.goto("/identity");
  });

  test.fixme("failed preview job surfaces the error and offers retry without resubmitting", async ({ page }) => {
    // TODO(wave2): scenario failed -> error message from the job; retry is an explicit new job,
    // never an automatic resubmit (mockRequests().jobPosts grows by exactly one per click).
    // Still blocked (checked 2026-10-30):
    // - Needs an identity first, so >=5 consented/AI faces in FACES_DIR (none in the repo).
    // - PreviewRun shows step.error.message, but has no Retry control. The only way to try again
    //   is clicking "Render preview sheet" again (a new POST /preview = one new job).
    await setMockScenario({ scenario: "failed" });
    await page.goto("/identity");
  });
});
