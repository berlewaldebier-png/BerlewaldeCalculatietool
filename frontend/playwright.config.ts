import { defineConfig, devices } from "@playwright/test";

const iPhone13 = devices["iPhone 13"];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    // In restricted Windows environments, spawning helper processes (trace/video)
    // can fail with EPERM. Keep this lightweight by default; enable locally when needed.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      browserName: "chromium",
      // Prefer the system browser to avoid EPERM issues spawning the bundled Playwright Chromium
      // in restricted environments.
      use: { ...devices["Desktop Chrome"], channel: "msedge" },
    },
    {
      name: "chromium-mobile",
      browserName: "chromium",
      // iPhone devices default to webkit; force chromium and emulate the device instead.
      use: {
        viewport: iPhone13.viewport,
        userAgent: iPhone13.userAgent,
        deviceScaleFactor: iPhone13.deviceScaleFactor,
        isMobile: iPhone13.isMobile,
        hasTouch: iPhone13.hasTouch,
        channel: "msedge",
      },
    },
  ],
});
