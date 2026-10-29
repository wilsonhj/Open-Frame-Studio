/**
 * Helpers for driving the mock Comfy server from Playwright specs (or any HTTP client).
 * The mock is started by playwright.config.ts on E2E_MOCK_PORT (default 8190).
 */
import type { JobPost, Scenario } from "./server.ts";

export const MOCK_URL = process.env.E2E_MOCK_URL ?? `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 8190}`;

export type MockControl = {
  scenario?: Scenario;
  contentMode?: "proxy" | "cloud";
  queuedMs?: number;
  /** Asset ids that answer 404 under the `asset_missing` scenario. */
  missingAssetIds?: string[];
};

/** Switch the scenario for jobs submitted from now on (global to the mock process). */
export async function setMockScenario(control: MockControl, base = MOCK_URL): Promise<MockControl> {
  const response = await fetch(`${base}/__mock/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(control),
  });
  if (!response.ok) throw new Error(`mock control failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as MockControl;
}

/** Restore defaults (succeeded, proxy, 20 s queue) and clear recorded requests. */
export async function resetMock(base = MOCK_URL): Promise<MockControl> {
  const response = await fetch(`${base}/__mock/reset`, { method: "POST" });
  if (!response.ok) throw new Error(`mock reset failed: ${response.status}`);
  return (await response.json()) as MockControl;
}

export type MockRequests = {
  assetPosts: number;
  /** Each POST /api/v2/jobs, with the asset ids its workflow used. */
  jobPosts: JobPost[];
};

/** Everything the app sent to the mock since the last reset (e.g. "exactly one job per click"). */
export async function mockRequests(base = MOCK_URL): Promise<MockRequests> {
  const response = await fetch(`${base}/__mock/requests`);
  if (!response.ok) throw new Error(`mock requests failed: ${response.status}`);
  return (await response.json()) as MockRequests;
}
