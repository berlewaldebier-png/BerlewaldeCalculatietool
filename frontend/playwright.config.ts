import { defineConfig, devices } from "@playwright/test";

const iPhone13 = devices["iPhone 13"];
const browserChannel = process.platform === "win32" ? "msedge" : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    // When credentials are provided, globalSetup writes an authenticated storage state.
    // Tests can reuse it to avoid repeated logins (prevents rate limiting).
    storageState: process.env.TEST_USERNAME && process.env.TEST_PASSWORD ? "playwright/.auth/storageState.json" : undefined,
    // In restricted Windows environments, spawning helper processes (trace/video)
    // can fail with EPERM. Keep this lightweight by default; enable locally when needed.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [
    {
      name: "chromium-desktop",
      // Prefer the system browser to avoid EPERM issues spawning the bundled Playwright Chromium
      // in restricted environments.
      use: { ...devices["Desktop Chrome"], browserName: "chromium", channel: browserChannel }
    },
    {
      name: "chromium-mobile",
      // iPhone devices default to webkit; force chromium and emulate the device instead.
      use: {
        browserName: "chromium",
        viewport: iPhone13.viewport,
        userAgent: iPhone13.userAgent,
        deviceScaleFactor: iPhone13.deviceScaleFactor,
        isMobile: iPhone13.isMobile,
        hasTouch: iPhone13.hasTouch,
        channel: browserChannel
      }
    }
  ]
});
