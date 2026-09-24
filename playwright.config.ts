import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local runs read the Clerk dev keys and the Convex DEV URL from .env.local. In CI they come
// from repository secrets (see docs/CI.md). Never point this at Convex prod.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// CI serves the production build (`next start`); locally `next dev` is quicker to iterate on.
const serverCommand = process.env.CI ? `npx next start -p ${port}` : `npx next dev -p ${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // One user + one team per run; the core flow is a single ordered journey.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: serverCommand,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: process.env.E2E_SERVER_LOGS ? "pipe" : "ignore",
      },
});
