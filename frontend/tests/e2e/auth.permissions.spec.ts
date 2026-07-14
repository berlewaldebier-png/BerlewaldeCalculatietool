import { expect, test } from "@playwright/test";

type Role = "admin" | "user";

async function mockBrowserSession(page: import("@playwright/test").Page, role: Role) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        username: `${role}-fixture`,
        display_name: `${role === "admin" ? "Admin" : "User"} Fixture`,
        role
      })
    });
  });
}

test.describe("Current role visibility characterization", () => {
  test("ordinary user hides admin-only menu items but keeps shared settings", async ({ page }) => {
    await mockBrowserSession(page, "user");
    await page.goto("/");

    await expect(page.locator(".dashboard-header__user-subtitle")).toContainText("Gebruiker");
    await page.getByRole("button", { name: "Accountmenu openen" }).click();

    await expect(page.getByRole("menuitem", { name: /Mijn account/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Kostprijsbeheer/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Bedrijfsinstellingen/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Calculatie instellingen/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Team & rechten/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Datakwaliteit/ })).toHaveCount(0);
  });

  test("administrator sees current admin-only menu items", async ({ page }) => {
    await mockBrowserSession(page, "admin");
    await page.goto("/");

    await expect(page.locator(".dashboard-header__user-subtitle")).toContainText("Admin");
    await page.getByRole("button", { name: "Accountmenu openen" }).click();

    await expect(page.getByRole("menuitem", { name: /Bedrijfsinstellingen/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Calculatie instellingen/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Team & rechten/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Datakwaliteit/ })).toBeVisible();
  });
});
