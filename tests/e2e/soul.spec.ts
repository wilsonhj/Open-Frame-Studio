/**
 * Soul ID (Instant): photo QA -> curated 3-6 reference crops + style card -> portable soul.json.
 * Plan: docs/PLAN.md "Update after Wave 0" (no trained LoRA). Spec: docs/spec/soul.md.
 *
 * Fixtures: fixtures/faces/ is intentionally EMPTY in the repo (no real faces). Flows that need a
 * face set read FACES_DIR and skip when absent; see fixtures/README.md.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { resetMock, setMockScenario } from "../mock-comfy/control.ts";

const FACES_DIR = process.env.E2E_FACES_DIR ?? join(process.cwd(), "fixtures/faces");
const faces = existsSync(FACES_DIR) ? readdirSync(FACES_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];

test.beforeEach(async () => {
  await resetMock();
});

test("Soul ID page renders", async ({ page }) => {
  await page.goto("/soul");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/soul/i);
});

test.describe("Soul ID wizard", () => {
  test.fixme("rejects too few photos and non-image files before upload", async ({ page }) => {
    // TODO(wave2 frontend: Soul wizard): client-side photo QA.
    // - < 5 photos: submit disabled with a "need 5-20 photos (8-12 ideal)" hint.
    // - > 20 photos: extra files refused with a visible message.
    // - a .txt / .gif file: refused by type, never uploaded (assert mock.assetPosts unchanged via
    //   mockRequests() from ../mock-comfy/control.ts: assetPosts stays 0).
    // - product fixtures (no face) should be flagged "no face found" once server QA exists.
    await page.goto("/soul");
  });

  test.fixme("instant Soul: upload -> QA -> pick refs -> preview sheet -> save soul.json", async ({ page }) => {
    test.skip(faces.length < 5, `needs >=5 consented/AI face images in ${FACES_DIR}`);
    // TODO(wave2 frontend+backend: Soul wizard, lib/soul/**):
    // 1. setInputFiles(faces.slice(0, 8)); per-photo QA chips render (face count, size >=1024px).
    // 2. Curated set: 3-6 refs auto-picked, user can swap one; style card fields editable.
    // 3. "Create Soul" submits the soul_instant preview pipeline (mock scenario: multi_output,
    //    so the preview sheet shows several images).
    // 4. Download soul.json: assert it parses, has refs[3..6] and a style card, and contains no
    //    absolute URLs to the mock/Cloud (refs are portable).
    await setMockScenario({ scenario: "multi_output" });
    await page.goto("/soul");
  });

  test.fixme("re-import a saved soul.json and reuse it in Photoshoot", async ({ page }) => {
    // TODO(wave2 Soul registry): import soul.json -> Soul library lists it -> "Use in Photoshoot"
    // navigates to /photoshoot with the Soul preselected.
    await page.goto("/soul");
  });

  test.fixme("shows queue wait, then progress, while the preview renders", async ({ page }) => {
    // TODO(wave2 frontend): with scenario queued_20s (queuedMs shortened), UI shows a "waiting for
    // a GPU" state with queue position; then slow_progress shows a rising progress bar.
    await setMockScenario({ scenario: "queued_20s", queuedMs: 3_000 });
    await page.goto("/soul");
  });

  test.fixme("failed preview job surfaces the error and offers retry without resubmitting", async ({ page }) => {
    // TODO(wave2): scenario failed -> error message from the job; retry is an explicit new job,
    // never an automatic resubmit (mockRequests().jobPosts grows by exactly one per click).
    await setMockScenario({ scenario: "failed" });
    await page.goto("/soul");
  });
});
