import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.getByLabel("Wachtwoord").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/(?!login)/);
}

test.describe("a11y smoke", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("core pages have no critical/serious a11y violations", async ({ page }) => {
    await login(page);

    const routes = ["/", "/break-even-v2", "/omzet-en-marge", "/beheer/productkoppeling", "/offerte-samenstellen"];

    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(
        criticalOrSerious,
        `Found ${criticalOrSerious.length} critical/serious a11y violations on ${route}`
      ).toEqual([]);
    }
  });
});
