import { test, expect, type Page } from "@playwright/test";

async function ensureLoggedIn(page: Page) {
  // Prefer reusing the authenticated storageState from globalSetup.
  await page.goto("/break-even-v2");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(process.env.TEST_USERNAME || "admin");
  await page.getByLabel("Wachtwoord").fill(process.env.TEST_PASSWORD || "admin");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("App smoke (read-only)", () => {
  test("login + core pages load", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();

    await page.goto("/nieuwe-kostprijsberekening");
    await expect(page.getByRole("heading", { name: /Kostprijs beheren/i })).toBeVisible();

    await page.goto("/offerte-samenstellen");
    await expect(page.getByRole("heading", { name: /Offerte samenstellen/i }).first()).toBeVisible();

    await page.goto("/nieuw-jaar-voorbereiden");
    await expect(page.getByRole("heading", { name: /Nieuw jaar/i }).first()).toBeVisible();
  });

  test("refresh + back button behavior on protected page", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();

    await page.goBack();
    // Back should not strand user on a blank state; typically returns to homepage.
    await expect(page).not.toHaveURL(/error/i);
  });
});
