import { expect, test, type Page } from "@playwright/test";

const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function ensureLoggedIn(page: Page) {
  await page.goto("/verkoopstrategie");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/verkoopstrategie");
}

function countMutationRequests(page: Page) {
  let count = 0;
  const listener = (request: { method(): string }) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) count += 1;
  };
  page.on("request", listener);
  return {
    value: () => count,
    stop: () => page.off("request", listener),
  };
}

test.describe("RF-012C4A sales-strategy active-context contract", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("keeps year, grouping and search interactions read-only", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page.getByRole("heading", { name: "Verkoopstrategie", level: 1 })).toBeVisible();

    const activeYearsetEmptyState = page.getByText("Geen actieve verkoopstrategie", { exact: true });
    if (await activeYearsetEmptyState.isVisible()) {
      await expect(page.getByText(/geen gereed geactiveerde jaarset/i)).toBeVisible();
      return;
    }

    const mutations = countMutationRequests(page);
    const yearSelect = page.locator("main select.dataset-input");
    await expect(yearSelect).toBeVisible();
    await expect(yearSelect).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Opslaan/ })).toBeVisible();

    const groupButtons = page.locator(".wizard-stack > section > button.module-card-title");
    const groupCount = await groupButtons.count();
    if (groupCount > 0) {
      await page.getByRole("button", { name: "Alles openen" }).click();
      await expect(page.locator("table.dataset-editor-table")).toHaveCount(groupCount);
      await expect(groupButtons.first()).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator('input[aria-label^="Lijstprijs "]').first()).toBeVisible();
      await page.getByRole("button", { name: "Alles sluiten" }).click();
      await expect(page.locator("table.dataset-editor-table")).toHaveCount(0);
      await expect(groupButtons.first()).toHaveAttribute("aria-expanded", "false");
    }

    const search = page.getByPlaceholder("Zoek stijl, SKU of code...", { exact: true });
    await search.fill("RF-012C4A-geen-resultaat");
    await expect(page.getByText("Geen SKU's gevonden.", { exact: true })).toBeVisible();
    await search.fill("");

    expect(mutations.value()).toBe(0);
    mutations.stop();
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
