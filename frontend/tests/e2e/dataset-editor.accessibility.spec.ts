import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function ensureLoggedIn(page: Page) {
  await page.goto("/bieren");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("RF-009B dataset editor behavior", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("editable controls have row and column names with unchanged keyboard order", async ({ page }, testInfo) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    await editor.getByRole("button", { name: "Rij toevoegen" }).click();
    const firstRow = editor.locator("tbody tr").first();
    const beerName = firstRow.getByRole("textbox", { name: "Biernaam, rij 1" });
    const style = firstRow.getByRole("textbox", { name: "Stijl, rij 1" });

    await expect(beerName).toBeVisible();
    await expect(style).toBeVisible();
    await expect(firstRow.getByRole("button", { name: "Rij 1 verwijderen" })).toBeVisible();

    await beerName.focus();
    await page.keyboard.press("Tab");
    await expect(style).toBeFocused();

    const results = await new AxeBuilder({ page })
      .include(".dataset-editor-table")
      .withRules(["label", "select-name", "button-name"])
      .analyze();
    expect(results.violations).toEqual([]);

    await testInfo.attach(`dataset-editor-${testInfo.project.name}`, {
      body: await editor.screenshot(),
      contentType: "image/png"
    });
  });

  test("adding and removing an unsaved row stays local", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    const rows = editor.locator("tbody tr:has(input)");
    const initialCount = await rows.count();

    await editor.getByRole("button", { name: "Rij toevoegen" }).click();
    await expect(rows).toHaveCount(initialCount + 1);

    await editor.getByRole("button", { name: /verwijderen/i }).last().click();
    await expect(rows).toHaveCount(initialCount);
  });

  test("save prevents duplicate submission and reports success without a backend write", async ({ page }) => {
    await ensureLoggedIn(page);

    let requestCount = 0;
    let finishRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });

    await page.route("**/api/data/productie", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      requestCount += 1;
      await requestGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/productie");
    const editor = page.locator(".module-card").filter({ hasText: "Productiedata" });
    const save = editor.getByRole("button", { name: /Opslaan/ });

    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(editor).toHaveAttribute("aria-busy", "true");
    expect(requestCount).toBe(1);

    finishRequest?.();
    await expect(editor.getByRole("status")).toHaveText("Opgeslagen.");
    await expect(save).toBeEnabled();
    await expect(save).toHaveAttribute("aria-busy", "false");
    expect(requestCount).toBe(1);
  });

  test("save failure is shown in the editor action area without a backend write", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.route("**/api/data/productie", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 500, contentType: "text/plain", body: "test failure detail" });
    });

    await page.goto("/productie");
    const editor = page.locator(".module-card").filter({ hasText: "Productiedata" });
    await editor.getByRole("button", { name: /Opslaan/ }).click();

    const status = editor.getByRole("alert");
    await expect(status).toContainText("Opslaan is niet volledig afgerond");
    await expect(status).toContainText("vernieuw de pagina");
    await expect(status).not.toContainText("test failure detail");
    const statusId = await status.getAttribute("id");
    expect(statusId).toBeTruthy();
    await expect(editor.getByRole("button", { name: "Opslaan" })).toHaveAttribute(
      "aria-describedby",
      statusId as string
    );
  });
});
