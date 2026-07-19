import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function ensureLoggedIn(page: Page, destination: string) {
  await page.goto(destination);
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(destination);
}

async function expectStatusHasNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include(".action-status")
    .withRules(["color-contrast"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("RF-009C shared action status", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("company settings announce pending and successful saves without writing data", async ({ page }, testInfo) => {
    await ensureLoggedIn(page, "/instellingen/bedrijf");

    let releaseRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requestCount = 0;
    await page.route("**/api/data/application-settings", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      requestCount += 1;
      await requestGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    const card = page.locator("section.module-card").filter({ hasText: "Bedrijfsgegevens" });
    const save = card.getByRole("button", { name: "Bedrijfsinstellingen opslaan" });
    await save.click();

    const pending = card.getByRole("status");
    await expect(pending).toContainText("Bedrijfsinstellingen worden opgeslagen");
    await expect(pending.locator(".action-status-spinner")).toBeVisible();
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    expect(requestCount).toBe(1);

    releaseRequest?.();
    await expect(pending).toContainText("Bedrijfsinstellingen zijn opgeslagen");
    await expect(pending).toHaveClass(/success/);
    await expect(card).toHaveAttribute("aria-busy", "false");
    await expect(save).toBeEnabled();
    await expectStatusHasNoAxeViolations(page);
    expect(requestCount).toBe(1);

    await testInfo.attach(`company-settings-status-${testInfo.project.name}`, {
      body: await card.screenshot(),
      contentType: "image/png",
    });
  });

  test("company settings failure explains an uncertain outcome without exposing technical detail", async ({ page }) => {
    await ensureLoggedIn(page, "/instellingen/bedrijf");
    await page.route("**/api/data/application-settings", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "test-only-internal-database-detail" }),
      });
    });

    const card = page.locator("section.module-card").filter({ hasText: "Bedrijfsgegevens" });
    const save = card.getByRole("button", { name: "Bedrijfsinstellingen opslaan" });
    await save.click();

    const status = card.getByRole("alert");
    await expect(status).toContainText("Opslaan kon niet worden bevestigd");
    await expect(status).toContainText("Vernieuw de pagina");
    await expect(status).not.toContainText("test-only-internal-database-detail");
    await expect(status).toHaveClass(/error/);
    await expect(save).toHaveAttribute("aria-describedby", await status.getAttribute("id") as string);
    await expectStatusHasNoAxeViolations(page);
  });

  test("password mismatch is announced with a corrective action and sends no request", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/auth/change-password", async (route) => {
      requestCount += 1;
      await route.abort();
    });
    await ensureLoggedIn(page, "/account");

    await page.getByLabel("Huidig wachtwoord").fill("current-password");
    await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill("new-password-one");
    await page.getByLabel("Nieuw wachtwoord herhalen").fill("new-password-two");
    const save = page.getByRole("button", { name: "Wachtwoord opslaan" });
    await save.click();

    const status = page.getByRole("alert");
    await expect(status).toContainText("Wachtwoorden komen niet overeen");
    await expect(status).toContainText("Controleer beide nieuwe wachtwoorden");
    await expect(save).toHaveAttribute("aria-describedby", await status.getAttribute("id") as string);
    await expectStatusHasNoAxeViolations(page);
    expect(requestCount).toBe(0);
  });

  test("password save has a spinner, prevents duplicates and reports success without changing a password", async ({ page }) => {
    await ensureLoggedIn(page, "/account");

    let releaseRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requestCount = 0;
    await page.route("**/api/auth/change-password", async (route) => {
      requestCount += 1;
      await requestGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"changed":true}' });
    });

    await page.getByLabel("Huidig wachtwoord").fill("current-password");
    await page.getByLabel("Nieuw wachtwoord", { exact: true }).fill("new-password");
    await page.getByLabel("Nieuw wachtwoord herhalen").fill("new-password");
    const save = page.getByRole("button", { name: "Wachtwoord opslaan" });
    await save.click();

    const form = page.locator("form").filter({ hasText: "Huidig wachtwoord" });
    const pending = form.getByRole("status");
    await expect(pending).toContainText("Wachtwoord wordt opgeslagen");
    await expect(pending.locator(".action-status-spinner")).toBeVisible();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(save).toBeDisabled();
    expect(requestCount).toBe(1);

    releaseRequest?.();
    await expect(pending).toContainText("Wachtwoord is gewijzigd");
    await expect(pending).toHaveClass(/success/);
    await expect(page.getByLabel("Huidig wachtwoord")).toHaveValue("");
    await expect(page.getByLabel("Nieuw wachtwoord", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Nieuw wachtwoord herhalen")).toHaveValue("");
    expect(requestCount).toBe(1);
  });
});
