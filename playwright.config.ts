import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.PI_WEB_E2E_PORT ?? "8787";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: ".runtime/playwright-report", open: "never" }]],
  outputDir: ".runtime/test-results",
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    locale: "zh-CN",
    trace: "on-first-retry"
  },
  webServer: {
    command: "node tests/e2e/start.mjs",
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
