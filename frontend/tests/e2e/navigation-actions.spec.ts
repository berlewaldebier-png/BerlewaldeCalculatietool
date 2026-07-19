import { expect, test, type Page } from "@playwright/test";

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

function countMutationRequests(page: Page) {
  let count = 0;
  const listener = (request: { method(): string }) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      count += 1;
    }
  };
  page.on("request", listener);
  return {
    value: () => count,
    stop: () => page.off("request", listener),
  };
}

test.describe("RF-009G navigation and form-action contract", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("tariff editor has an explicit no-write return to company settings", async ({ page }, testInfo) => {
    await ensureLoggedIn(page, "/instellingen/bedrijf");
    await page.getByRole("link", { name: "Open Tarieven & heffingen" }).click();
    await expect(page).toHaveURL(/\/tarieven-heffingen$/);

    const mutations = countMutationRequests(page);
    const back = page.getByRole("link", { name: "Terug naar Bedrijfsinstellingen" });
    await expect(back).toHaveAttribute("href", "/instellingen/bedrijf");

    await testInfo.attach(`rf-009g-tariff-back-${testInfo.project.name}`, {
      body: await page.locator(".content-card").screenshot(),
      contentType: "image/png",
    });

    await back.click();
    await expect(page).toHaveURL(/\/instellingen\/bedrijf$/);
    expect(mutations.value()).toBe(0);
    mutations.stop();
  });

  test("article cost wizard keeps back, previous and next as no-write navigation", async ({ page }, testInfo) => {
    await ensureLoggedIn(page, "/nieuwe-kostprijsberekening?mode=wizard-new&kind=article");
    const mutations = countMutationRequests(page);
    const actions = page.getByRole("group", { name: "Acties voor artikelkostprijsberekening" });

    const back = actions.getByRole("button", { name: "Terug naar Kostprijs beheren" });
    const save = actions.getByRole("button", { name: "Opslaan", exact: true });
    const next = actions.getByRole("button", { name: "Volgende" });
    await expect(back).toBeVisible();
    await expect(save).toBeVisible();
    await expect(next).toBeVisible();

    await next.click();
    await expect(page.getByText("Stap 2: Samenstelling", { exact: true })).toBeVisible();
    expect(mutations.value()).toBe(0);

    const previous = actions.getByRole("button", { name: "Vorige", exact: true });
    await previous.focus();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();

    await testInfo.attach(`rf-009g-article-actions-${testInfo.project.name}`, {
      body: await actions.screenshot(),
      contentType: "image/png",
    });

    await previous.click();
    await expect(page.getByText("Stap 1: Basisgegevens", { exact: true })).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/nieuwe-kostprijsberekening$/);
    expect(mutations.value()).toBe(0);
    mutations.stop();
  });

  test("product wizard labels local continuation and history navigation truthfully", async ({ page }, testInfo) => {
    await ensureLoggedIn(page, "/producten-verpakking");
    await page.locator('a[href="/product-samenstellen"]').click();
    await expect(page).toHaveURL(/\/product-samenstellen$/);

    const mutations = countMutationRequests(page);
    const actions = page.getByRole("group", { name: "Acties voor product samenstellen" });
    const back = actions.getByRole("button", { name: "Terug naar vorige pagina" });
    const save = actions.getByRole("button", { name: "Opslaan", exact: true });
    const next = actions.getByRole("button", { name: "Volgende" });
    await expect(back).toBeVisible();
    await expect(save).toBeVisible();
    await expect(next).toBeVisible();

    await next.click();
    await expect(page.getByText("Stap 2: Samenstelling", { exact: true })).toBeVisible();
    expect(mutations.value()).toBe(0);

    const previous = actions.getByRole("button", { name: "Vorige", exact: true });
    await previous.focus();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();

    await next.click();
    await next.click();
    await expect(page.getByText("Stap 4: Controle", { exact: true })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Opslaan en doorgaan" })).toBeVisible();
    expect(mutations.value()).toBe(0);

    await testInfo.attach(`rf-009g-product-actions-${testInfo.project.name}`, {
      body: await actions.screenshot(),
      contentType: "image/png",
    });

    await back.click();
    await expect(page).toHaveURL(/\/producten-verpakking$/);
    expect(mutations.value()).toBe(0);
    mutations.stop();
  });
});
