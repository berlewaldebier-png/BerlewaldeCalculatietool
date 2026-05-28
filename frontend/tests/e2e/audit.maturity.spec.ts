import { test, expect, chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin";

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `audit/artifacts/${name}`,
    fullPage: true
  });
}

async function ensureLoggedIn(page: Page) {
  await page.goto("/break-even-v2");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(USERNAME);
  await page.getByLabel("Wachtwoord").fill(PASSWORD);
  await screenshot(page, "01-login-form.png");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("Maturity audit (read-only)", () => {
  test("Happy path: navigation + core pages (desktop)", async ({ page }) => {
    await ensureLoggedIn(page);

    await page.goto("/");
    await screenshot(page, "02-home.png");

    await page.goto("/break-even-v2");
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();
    await screenshot(page, "03-break-even-v2.png");

    await page.goto("/omzet-en-marge");
    await expect(page.getByRole("heading", { name: /Omzet/i })).toBeVisible();
    await screenshot(page, "04-omzet-en-marge.png");

    await page.goto("/nieuwe-kostprijsberekening");
    await expect(page.getByRole("heading", { name: /Kostprijs beheren/i })).toBeVisible();
    await screenshot(page, "05-kostprijs-beheren.png");

    await page.goto("/beheer/productkoppeling");
    await expect(page.getByRole("heading", { name: /Productkoppeling/i })).toBeVisible();
    await screenshot(page, "06-productkoppeling.png");

    await page.goto("/nieuw-jaar-voorbereiden");
    await expect(page.getByRole("heading", { name: /Nieuw jaar/i }).first()).toBeVisible();
    await screenshot(page, "07-nieuw-jaar-voorbereiden.png");

    await page.goto("/offerte-samenstellen");
    await expect(page.getByRole("heading", { name: /Offerte samenstellen/i }).first()).toBeVisible();
    await screenshot(page, "08-offerte-samenstellen.png");
  });

  test("Resilience: refresh/back on multi-step route", async ({ page }) => {
    await ensureLoggedIn(page);

    await page.goto("/nieuwe-kostprijsberekening");
    await expect(page.getByRole("heading", { name: /Kostprijs beheren/i })).toBeVisible();
    await screenshot(page, "09-kostprijs-initial.png");

    await page.reload();
    await expect(page.getByRole("heading", { name: /Kostprijs beheren/i })).toBeVisible();

    await page.goto("/break-even-v2");
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: /Kostprijs beheren/i })).toBeVisible();
    await screenshot(page, "10-back-behavior.png");
  });

  test("Error path: offline during data load (shows recoverable error)", async ({ page, context }) => {
    await ensureLoggedIn(page);

    // Navigate online first so we can test recovery behavior on reload.
    await page.goto("/break-even-v2");
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload().catch(() => null);
    await page.waitForTimeout(1500);
    await screenshot(page, "11-offline-break-even.png");

    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Break-even analyseren/i })).toBeVisible();
    await screenshot(page, "12-recovered-break-even.png");
  });

  test("Form validation: login errors are clear", async ({ browser, baseURL }) => {
    // Use a persistent context with a fresh userDataDir so no system/browser-profile cookies leak in.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "calculatietool-audit-"));
    const context = await chromium.launchPersistentContext(userDataDir, { channel: "msedge", baseURL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Gebruikersnaam").fill("wrong-user");
    await page.getByLabel("Wachtwoord").fill("wrong-pass");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page.locator(".login-error")).toBeVisible();
    await expect(page.locator(".login-error")).not.toHaveText(/^\\s*$/);
    await screenshot(page, "13-login-invalid.png");
    await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
});
