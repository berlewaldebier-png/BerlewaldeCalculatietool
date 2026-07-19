import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function inputValues(inputs: Locator) {
  return inputs.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value)
  );
}

function normalizedSort(values: string[], direction: "asc" | "desc") {
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const left = a.value.trim().toLowerCase();
      const right = b.value.trim().toLowerCase();
      const comparison = left === right ? 0 : left < right ? -1 : 1;
      return (direction === "asc" ? comparison : -comparison) || a.index - b.index;
    })
    .map(({ value }) => value);
}

test.describe("RF-009F editable table characterization", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("keeps input order until the user requests ascending or descending sorting", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    const names = editor.getByRole("textbox", { name: /^Biernaam, rij/ });
    const initialOrder = await inputValues(names);
    expect(initialOrder.length).toBeGreaterThan(1);

    await page.reload();
    await expect(editor).toBeVisible();
    expect(await inputValues(names)).toEqual(initialOrder);

    const sortButton = editor.getByRole("button", { name: /Biernaam/ });
    await sortButton.click();
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "asc"));

    await sortButton.click();
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "desc"));

    await sortButton.focus();
    await page.keyboard.press("Enter");
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "asc"));
  });

  test("sorting resets pagination and keeps edited values attached to their row", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    const firstRow = editor.locator("tbody tr").first();
    const originalId = await firstRow.getByRole("textbox", { name: /^ID, rij/ }).inputValue();
    const temporaryName = "ZZZ RF-009F tijdelijke browserwaarde";
    await firstRow.getByRole("textbox", { name: /^Biernaam, rij/ }).fill(temporaryName);

    await editor.getByRole("button", { name: /Biernaam/ }).click();
    await editor.getByRole("button", { name: /Biernaam/ }).click();

    const editedRowIndex = await editor.locator("tbody tr").evaluateAll(
      (rowElements, expectedName) =>
        rowElements.findIndex((row) =>
          Array.from(row.querySelectorAll("input")).some((input) => input.value === expectedName)
        ),
      temporaryName
    );
    expect(editedRowIndex).toBeGreaterThanOrEqual(0);
    const editedRow = editor.locator("tbody tr").nth(editedRowIndex);
    expect(await editedRow.locator("input").first().inputValue()).toBe(originalId);

    await editor.getByLabel("Per pagina").selectOption("5");
    if (await editor.getByRole("button", { name: "Volgende" }).isVisible()) {
      await editor.getByRole("button", { name: "Volgende" }).click();
      await expect(editor.getByRole("button", { name: "Vorige" })).toBeVisible();

      await editor.getByRole("button", { name: /Biernaam/ }).press("Enter");
      await expect(editor.getByRole("button", { name: "Vorige" })).toHaveCount(0);
      await expect(editor.getByRole("textbox", { name: /rij 1$/ }).first()).toBeVisible();
    }
  });
});
