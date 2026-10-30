/**
 * Motion (MiniMax H3 reference-to-video): person still + product still -> short clip.
 * Graph: workflows/h3_r2v.api.json (spike: docs/spikes/h3-r2v.md). Preview = 4-step turbo, Final = 20 base steps.
 */
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { mockRequests, resetMock, setMockScenario } from "../mock-comfy/control.ts";

const PRODUCT = join(process.cwd(), "fixtures/products/product-bottle-confetti.png");
// The mock doesn't check faces: any valid PNG stands in for the person still.
const PERSON = join(process.cwd(), "fixtures/products/product-mug-tiles.png");

type Graph = Record<string, { class_type?: string; inputs: Record<string, unknown> }>;

async function submittedGraphs(): Promise<Graph[]> {
  const { jobPosts } = await mockRequests();
  return jobPosts.map((p) => p.body.workflow as Graph);
}

test.beforeEach(async () => {
  await resetMock();
  await setMockScenario({ scenario: "succeeded", queuedMs: 0 });
});

test("Motion page renders with the H3 licence notice", async ({ page }) => {
  await page.goto("/motion");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/motion/i);
  const notice = page.getByTestId("h3-licence");
  await expect(notice).toContainText("MiniMax H3 Community License");
  await expect(notice).toContainText("not a permissive");
  await expect(page.getByRole("button", { name: "Roll clip" })).toBeDisabled();
});

test.describe("Motion panel", () => {
  test("person + product -> one Final job (turbo off, 20 steps) -> clip renders in a <video>", async ({ page }) => {
    await page.goto("/motion");
    await page.getByTestId("person-input").setInputFiles(PERSON);
    await page.getByTestId("product-input").setInputFiles(PRODUCT);
    await expect(page.getByTestId("motion-estimate")).toHaveText(/1 job · 20 steps · 124 frames/);
    await expect(page.getByTestId("motion-time")).toContainText("Preview ≈ 20 s · Final ≈ 1–2 min, plus any queue");
    await expect(page.getByTestId("motion-time")).toContainText("Cancel asks Comfy to stop the job");
    await page.getByRole("button", { name: "Roll clip" }).click();

    const video = page.getByTestId("motion-video");
    await expect(video).toBeVisible({ timeout: 30_000 });
    await expect(video).toHaveAttribute("src", /^\/api\/pipelines\/motion\//);
    await expect(page.getByRole("link", { name: "Download MP4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Roll final" })).toHaveCount(0);

    const graphs = await submittedGraphs();
    expect(graphs).toHaveLength(1);
    const [g] = graphs;
    expect(g["146"].inputs.value).toBe(false); // turbo off
    expect(g["143"].inputs.value).toBe(20); // base steps
    expect(String(g["138"].inputs.value)).toContain("<Picture 1> is the person");
    expect(String(g["138"].inputs.value)).toContain("<Picture 1> holds <Picture 2>");
    expect(g["119"].inputs.vae_name).toBe("minimax_h3_video_vae_fp16.safetensors");
  });

  test("Preview is turbo (4 steps); Roll final re-renders the same seed with turbo off", async ({ page }) => {
    await page.goto("/motion");
    await page.getByTestId("person-input").setInputFiles(PERSON);
    await page.getByTestId("product-input").setInputFiles(PRODUCT);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "16:9" }).click();
    await expect(page.getByTestId("motion-estimate")).toHaveText(/4 steps/);
    await page.getByRole("button", { name: "Roll clip" }).click();
    await expect(page.getByTestId("motion-video")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Roll final" }).click();
    await expect.poll(async () => (await submittedGraphs()).length, { timeout: 30_000 }).toBe(2);
    await expect(page.getByTestId("motion-video")).toBeVisible({ timeout: 30_000 });

    const [preview, final] = await submittedGraphs();
    expect(preview["146"].inputs.value).toBe(true);
    expect(preview["144"].inputs.value).toBe(4);
    expect(preview["115"].inputs.aspect_ratio).toBe("16:9 (Widescreen)");
    expect(final["146"].inputs.value).toBe(false);
    expect(final["129"].inputs.noise_seed).toBe(preview["129"].inputs.noise_seed);
    expect(final["115"].inputs.aspect_ratio).toBe("16:9 (Widescreen)");
    // Roll final reuses the stored assets: no new uploads for the second job.
    const { jobPosts } = await mockRequests();
    expect(jobPosts[1].assetIds).toEqual(jobPosts[0].assetIds);
  });

  test.fixme("an identity as Picture 1 uses its primary ref", async ({ page }) => {
    // TODO(slice C): once bestRefs is real, set MOTION_IDENTITIES_ENABLED and SoulLibrary lists identities (GET /api/souls); pick one: the job's image_1
    // asset is that identity's ★1 ref (bestRefs(id, 1)), and no person upload is sent.
    // Still blocked on the app, not the mock: MOTION_IDENTITIES_ENABLED (lib/motion/options.ts) is a hard-coded
    // `false`, so /motion renders no identity picker and validateMotion refuses any identityId with a 400.
    await page.goto("/motion");
  });

  test("long H3 job: queue wait then a rising progress bar", async ({ page }) => {
    test.setTimeout(120_000);
    await setMockScenario({ scenario: "queued_20s", queuedMs: 3_000 });
    await page.goto("/motion");
    await page.getByTestId("person-input").setInputFiles(PERSON);
    await page.getByTestId("product-input").setInputFiles(PRODUCT);
    await page.getByRole("button", { name: "Roll clip" }).click();
    // Queued upstream: the wait is named, not a silent spinner (ux.md: every wait shows a state).
    await expect(page.getByText("Waiting for a GPU…")).toBeVisible();
    const video = page.getByTestId("motion-video");
    await expect(video).toBeVisible({ timeout: 30_000 });

    // A long render: run.progress follows Comfy's progress, so the bar fills across polls.
    await setMockScenario({ scenario: "slow_progress" });
    await page.getByRole("button", { name: "Roll clip" }).click();
    await expect(page.getByText("Rendering the clip…")).toBeVisible();
    const bar = page.getByRole("progressbar", { name: "Clip progress" });
    const seen: number[] = [];
    await expect
      .poll(
        async () => {
          const value = await bar.getAttribute("value", { timeout: 200 }).catch(() => null);
          if (value !== null && Number(value) !== seen.at(-1)) seen.push(Number(value));
          return seen.length;
        },
        { timeout: 45_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(3);
    // Strictly rising, and always a real fraction (never a stuck 0 or a premature 1).
    expect(seen.every((v, i) => v > 0 && v < 1 && (i === 0 || v > seen[i - 1]))).toBe(true);
    await expect(video).toBeVisible({ timeout: 45_000 });
  });

  test.fixme("job stuck in unknown hits the step deadline with a clear message", async ({ page }) => {
    // TODO: scenario unknown_forever; needs a test hook to shorten the 15-min h3_r2v step budget;
    // the step ends timed_out and is never resubmitted.
    // Still blocked on the app: the budget is DEFAULT_STEP_TIMEOUT_MS.h3_r2v = 900_000 (lib/contracts/pipeline.ts)
    // with no env override (JOB_DEADLINE_MS only covers /api/jobs), and the playwright webServer env can't be set
    // from a spec. Also: the runner ends the step with code "poll_timeout", but MotionStudio's errorText() only
    // special-cases "timed_out", so the user would see the raw "Job … was still unknown after 900000 ms" text.
    await setMockScenario({ scenario: "unknown_forever" });
    await page.goto("/motion");
  });
});
