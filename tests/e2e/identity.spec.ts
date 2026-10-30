/**
 * Identity (Instant): photo QA -> curated 3-6 reference crops + style card -> portable identity.json.
 * Plan: docs/PLAN.md "Update after Wave 0" (no trained LoRA). Spec: docs/spec/identity.md.
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

test("Identity page renders", async ({ page }) => {
  await page.goto("/identity");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/identity/i);
});

test.describe("Identity wizard", () => {
  test.fixme("rejects too few photos and non-image files before upload", async ({ page }) => {
    // TODO(wave2 frontend: Identity wizard): client-side photo QA.
    // - < 5 photos: submit disabled with a "need 5-20 photos (8-12 ideal)" hint.
    // - > 20 photos: extra files refused with a visible message.
    // - a .txt / .gif file: refused by type, never uploaded (assert mock.assetPosts unchanged via
    //   mockRequests() from ../mock-comfy/control.ts: assetPosts stays 0).
    // - product fixtures (no face) should be flagged "no face found" once server QA exists.
    await page.goto("/identity");
  });

  test.fixme("instant Identity: upload -> QA -> pick refs -> preview sheet -> save identity.json", async ({ page }) => {
    test.skip(faces.length < 5, `needs >=5 consented/AI face images in ${FACES_DIR}`);
    // TODO(wave2 frontend+backend: Identity wizard, lib/identity/**):
    // 1. setInputFiles(faces.slice(0, 8)); per-photo QA chips render (face count, size >=1024px).
    // 2. Curated set: 3-6 refs auto-picked, user can swap one; style card fields editable.
    // 3. "Create Identity" submits the identity_instant preview pipeline (mock scenario: multi_output,
    //    so the preview sheet shows several images).
    // 4. Download identity.json: assert it parses, has refs[3..6] and a style card, and contains no
    //    absolute URLs to the mock/Cloud (refs are portable).
    await setMockScenario({ scenario: "multi_output" });
    await page.goto("/identity");
  });

  test.fixme("S-R1: Identity reuse across separate jobs after export/import (docs/spec/identity.md §6.6)", async ({ page }) => {
    test.skip(faces.length < 5, `needs >=5 consented/AI face images in ${FACES_DIR}`);
    // TODO(wave2 Identity registry + frontend): the UI and /api/identities routes do not exist yet.
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
    await setMockScenario({ scenario: "queued_20s", queuedMs: 3_000 });
    await page.goto("/identity");
  });

  test.fixme("failed preview job surfaces the error and offers retry without resubmitting", async ({ page }) => {
    // TODO(wave2): scenario failed -> error message from the job; retry is an explicit new job,
    // never an automatic resubmit (mockRequests().jobPosts grows by exactly one per click).
    await setMockScenario({ scenario: "failed" });
    await page.goto("/identity");
  });
});
