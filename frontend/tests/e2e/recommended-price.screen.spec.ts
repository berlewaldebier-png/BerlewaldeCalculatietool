import { expect, test, type Page } from "@playwright/test";

const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function ensureLoggedIn(page: Page) {
  await page.goto("/adviesprijzen");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/adviesprijzen");
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

test.describe("RF-012C4B recommended-price active-context contract", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("keeps active year, VAT, search and channel interactions read-only", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page.getByRole("heading", { name: "Adviesprijzen", level: 1 })).toBeVisible();

    const emptyState = page.getByText("Geen actieve adviesprijzen", { exact: true });
    if (await emptyState.isVisible()) {
      await expect(page.getByText(/geen gereed geactiveerde jaarset/i)).toBeVisible();
      return;
    }

    const mutations = countMutationRequests(page);
    const yearSelect = page.getByRole("combobox", { name: "Jaar", exact: true });
    await expect(yearSelect).toBeVisible();
    await expect(yearSelect).toBeDisabled();
    await expect(yearSelect.locator("option")).toHaveCount(1);

    const markupInputs = page.getByRole("spinbutton", { name: /^Opslag \(%\) voor / });
    expect(await markupInputs.count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /^Opslaan/ })).toBeVisible();

    const channelDetails = page.locator("main details");
    const channelCount = await channelDetails.count();
    expect(channelCount).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Alles inklappen" }).click();
    await expect(page.locator("main details[open]")).toHaveCount(0);
    await page.getByRole("button", { name: "Alles uitklappen" }).click();
    await expect(page.locator("main details[open]")).toHaveCount(channelCount);

    await expect(page.getByRole("columnheader", { name: "Sell-in (ex)" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Incl. BTW" }).click();
    await expect(page.getByRole("columnheader", { name: "Adviesprijs (incl)" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Excl. BTW" }).click();
    await expect(page.getByRole("columnheader", { name: "Adviesprijs (ex)" }).first()).toBeVisible();

    const search = page.getByPlaceholder("Zoek stijl, SKU of code...", { exact: true });
    await search.fill("RF-012C4B-geen-resultaat");
    await expect(page.getByText("Geen SKU's gevonden.").first()).toBeVisible();
    await search.fill("");

    expect(mutations.value()).toBe(0);
    mutations.stop();
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
