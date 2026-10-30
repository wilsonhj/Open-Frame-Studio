import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: Next.js app + the offline mock Comfy API (tests/mock-comfy).
 * Never talks to Comfy Cloud: COMFY_BASE_URL points at the mock and COMFY_API_KEY is a dummy.
 *
 *   pnpm test:e2e                 # starts both servers, runs tests/e2e/*.spec.ts
 *   E2E_APP_PORT / E2E_MOCK_PORT  # override ports if they clash
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 8190);
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

// Prefer Playwright's own browser lookup (PLAYWRIGHT_BROWSERS_PATH). If that build is missing,
// fall back to a pre-installed Chromium. Never run `playwright install` in this environment.
const FALLBACK_CHROMIUM = [
  process.env.E2E_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
  "/opt/pw-browsers/chromium/chrome-linux64/chrome",
].find((path): path is string => Boolean(path && existsSync(path)));

function bundledChromiumPresent(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const executablePath = process.env.E2E_CHROMIUM_PATH ?? (bundledChromiumPresent() ? undefined : FALLBACK_CHROMIUM);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1, // one shared mock: scenario switches are global state
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: [
    {
      command: "node --experimental-strip-types tests/mock-comfy/server.ts",
      url: `${MOCK_URL}/__mock/health`,
      env: { PORT: String(MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${APP_PORT}`,
      url: APP_URL,
      env: {
        COMFY_BASE_URL: MOCK_URL,
        COMFY_API_KEY: "mock-key-not-a-secret",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
