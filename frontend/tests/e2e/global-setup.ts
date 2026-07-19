import { existsSync } from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
  const username = process.env.TEST_USERNAME || "";
  const password = process.env.TEST_PASSWORD || "";

  if (!baseURL || !username || !password) {
    // Allow running tests without auth (tests should skip accordingly).
    return;
  }

  // Keep auth outside Playwright's test-results output, which is cleared at
  // the start of every separate Playwright command in CI.
  const storageStatePath = "playwright/.auth/storageState.json";
  const browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined
  });
  try {
    if (existsSync(storageStatePath)) {
      const storedContext = await browser.newContext({ storageState: storageStatePath });
      try {
        const response = await storedContext.request.get(new URL("/api/auth/me", baseURL).toString());
        const payload = response.ok() ? await response.json().catch(() => null) : null;
        if (payload?.authenticated === true) {
          return;
        }
      } finally {
        await storedContext.close();
      }
    }

    const page = await browser.newPage();
    await page.goto(new URL("/login", baseURL).toString());
    await page.getByLabel("Gebruikersnaam").fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Inloggen" }).click();

    // Wait until we are not on /login anymore (server-side redirect happens after cookie is set).
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    await page.context().storageState({ path: storageStatePath });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
