import { chromium, type FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
  const username = process.env.TEST_USERNAME || "";
  const password = process.env.TEST_PASSWORD || "";

  if (!baseURL || !username || !password) {
    // Allow running tests without auth (tests should skip accordingly).
    return;
  }

  const browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined
  });
  const page = await browser.newPage();

  const meResponse = await page.request.get(new URL("/api/auth/me", baseURL).toString());
  if (meResponse.ok()) {
    // Auth-disabled development mode already exposes the synthetic local admin.
    await page.goto(new URL("/", baseURL).toString());
  } else {
    await page.goto(new URL("/login", baseURL).toString());
    await page.getByLabel("Gebruikersnaam").fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Inloggen" }).click();
  }

  // Wait until we are not on /login anymore (server-side redirect happens after cookie is set).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

  const storageStatePath = "test-results/.auth/storageState.json";
  await page.context().storageState({ path: storageStatePath });

  await browser.close();
}

export default globalSetup;
