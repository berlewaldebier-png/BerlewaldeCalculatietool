import { expect, test } from "@playwright/test";

type Role = "admin" | "management" | "brewer" | "sales";

const capabilitiesByRole = {
  admin: ["admin:all"],
  management: [
    "users:view",
    "costs:view",
    "costs:draft",
    "costs:activate",
    "quotes:manage",
    "calculation-settings:manage"
  ],
  brewer: ["costs:view", "costs:draft"],
  sales: ["costs:view", "quotes:manage"]
} as const;

const labelsByRole: Record<Role, string> = {
  admin: "Admin",
  management: "Management",
  brewer: "Brouwer",
  sales: "Sales"
};

async function mockBrowserSession(page: import("@playwright/test").Page, role: Role) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        username: `${role}-fixture`,
        display_name: `${labelsByRole[role]} Fixture`,
        role,
        capabilities: capabilitiesByRole[role]
      })
    });
  });
}

test.describe("RF-005 role visibility", () => {
  test("sales can view cost prices but not administrative settings", async ({ page }) => {
    await mockBrowserSession(page, "sales");
    await page.goto("/");

    await expect(page.locator(".dashboard-header__user-subtitle")).toContainText("Sales");
    await page.getByRole("button", { name: "Accountmenu openen" }).click();

    await expect(page.getByRole("menuitem", { name: /Mijn account/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Kostprijsbeheer/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Bedrijfsinstellingen/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Calculatie instellingen/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Team & rechten/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Datakwaliteit/ })).toHaveCount(0);
  });

  test("brewer can view cost prices but not quotes or administrative settings", async ({ page }) => {
    await mockBrowserSession(page, "brewer");
    await page.goto("/");

    await expect(page.locator(".dashboard-header__user-subtitle")).toContainText("Brouwer");
    await page.getByRole("button", { name: "Accountmenu openen" }).click();

    await expect(page.getByRole("menuitem", { name: /Kostprijsbeheer/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Bedrijfsinstellingen/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Team & rechten/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Datakwaliteit/ })).toHaveCount(0);
  });

  test("management can view users and calculation settings but cannot synchronize Douano", async ({ page }) => {
    await mockBrowserSession(page, "management");
    await page.goto("/");

    await expect(page.locator(".dashboard-header__user-subtitle")).toContainText("Management");
    await page.getByRole("button", { name: "Accountmenu openen" }).click();

    await expect(page.getByRole("menuitem", { name: /Bedrijfsinstellingen/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Calculatie instellingen/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Team & rechten/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Datakwaliteit/ })).toHaveCount(0);
  });

  test("administrator sees all role-gated menu items", async ({ page }) => {
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
