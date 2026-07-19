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

async function addUnsavedBeer(editor: Locator, name: string, style: string) {
  const names = editor.getByRole("textbox", { name: /^Biernaam, rij/ });
  const previousCount = await names.count();
  await editor.getByRole("button", { name: "Rij toevoegen" }).click();
  await expect(names).toHaveCount(previousCount + 1);

  const nameInput = names.last();
  const row = nameInput.locator("xpath=ancestor::tr");
  await nameInput.fill(name);
  await row.getByRole("textbox", { name: /^Stijl, rij/ }).fill(style);
}

test.describe("RF-009F editable table characterization", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("keeps input order until the user requests ascending or descending sorting", async ({ page }, testInfo) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    await editor.getByLabel("Per pagina").selectOption("0");
    const names = editor.getByRole("textbox", { name: /^Biernaam, rij/ });
    const serverOrder = await inputValues(names);
    const temporaryNames = ["Zulu RF009F", "alpha RF009F", "Mike RF009F"];
    for (const [index, name] of temporaryNames.entries()) {
      await addUnsavedBeer(editor, name, `Tijdelijke stijl ${index + 1}`);
    }

    const initialOrder = [...serverOrder, ...temporaryNames];
    expect(await inputValues(names)).toEqual(initialOrder);

    const sortButton = editor.getByRole("button", { name: /Biernaam/ });
    await sortButton.click();
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "asc"));

    await sortButton.click();
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "desc"));

    await sortButton.focus();
    await page.keyboard.press("Enter");
    expect(await inputValues(names)).toEqual(normalizedSort(initialOrder, "asc"));

    await testInfo.attach(`rf-009f-sorting-${testInfo.project.name}`, {
      body: await editor.screenshot(),
      contentType: "image/png"
    });
  });

  test("sorting resets pagination and keeps edited values attached to their row", async ({ page }, testInfo) => {
    await ensureLoggedIn(page);
    await page.goto("/bieren");

    const editor = page.locator(".module-card").filter({ hasText: "Bierstamdata" });
    await editor.getByLabel("Per pagina").selectOption("0");
    const temporaryName = "ZZZ RF-009F tijdelijke browserwaarde";
    const temporaryStyle = "RF-009F gekoppelde stijl";
    const temporaryRows = [
      [temporaryName, temporaryStyle],
      ["Bravo RF009F", "Stijl B"],
      ["Charlie RF009F", "Stijl C"],
      ["Delta RF009F", "Stijl D"],
      ["Echo RF009F", "Stijl E"],
      ["Foxtrot RF009F", "Stijl F"]
    ] as const;
    for (const [name, style] of temporaryRows) {
      await addUnsavedBeer(editor, name, style);
    }

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
    await expect(editedRow.getByRole("textbox", { name: /^Stijl, rij/ })).toHaveValue(temporaryStyle);

    await editor.getByLabel("Per pagina").selectOption("5");
    await editor.getByRole("button", { name: "Volgende" }).press("Enter");
    await expect(editor.getByRole("button", { name: "Vorige" })).toBeVisible();

    await editor.getByRole("button", { name: /Biernaam/ }).press("Enter");
    await expect(editor.getByRole("button", { name: "Vorige" })).toHaveCount(0);
    await expect(editor.getByRole("textbox", { name: /rij 1$/ }).first()).toBeVisible();

    await testInfo.attach(`rf-009f-pagination-${testInfo.project.name}`, {
      body: await editor.screenshot(),
      contentType: "image/png"
    });
  });
});
