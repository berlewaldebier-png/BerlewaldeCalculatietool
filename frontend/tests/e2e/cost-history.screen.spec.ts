import { expect, test, type Page } from "@playwright/test";


const TEST_USERNAME = process.env.TEST_USERNAME || "";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";


async function ensureLoggedIn(page: Page) {
  await page.goto("/nieuwe-kostprijsberekening");
  if (!/\/login/.test(page.url())) return;

  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(TEST_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/nieuwe-kostprijsberekening");
}


const overview = {
  version: "rf-012d2-v1",
  status: "ready",
  read_only: true,
  binding: {
    generation_id: "generation-2026",
    run_id: "run-2026",
    operational_year: 2026,
    manifest_hash: "manifest",
    validation_hash: "validation",
  },
  groups: [
    {
      key: "beer:juweel",
      label: "Berlewalde het Juweel",
      kind: "beer",
      priority: 0,
      items: [
        {
          sku_id: "juweel-box",
          sku_code: "JUWEEL-24X33",
          sku_name: "Berlewalde het Juweel - Doos 24 * 33cl",
          beer_name: "Berlewalde het Juweel",
          subject_type: "beer",
          scope_classification: "carried_forward",
          calculation_method: "year_transition",
          cost_method: "inkoop",
          provenance_kind: "recovered_from_exact_target_anchor",
          provenance_source_year: 2026,
          primary_cost: 17.05,
          packaging_cost: 0,
          overhead_cost: 19,
          excise_cost: 2.07,
          cost_price: 38.12,
          cost_state: "ready",
          cost_blocker_codes: [],
          display_priority: 0,
        },
      ],
    },
  ],
  summary: { sku_count: 1, group_count: 1, ready_count: 1, missing_cost_count: 0, not_activated_count: 0, not_applicable_count: 0 },
  shadow_parity: { status: "match", generation_sku_count: 1, legacy_activation_sku_count: 1, shared_sku_count: 1, only_generation_count: 0, only_legacy_count: 0 },
  reason_codes: [],
};


const history = {
  version: "rf-012d3-v1",
  status: "ready",
  read_only: true,
  binding: overview.binding,
  summary: {
    sku_count: 1,
    source_anchor_verified_count: 0,
    target_anchor_verified_count: 1,
    active_generation_only_count: 0,
    not_applicable_count: 0,
    cost_version_count: 2,
    additional_variant_count: 1,
    canonical_lot_count: 1,
    unverified_declared_lot_count: 1,
    direct_lot_evidence_count: 1,
    unresolved_evidence_count: 2,
  },
  histories: [
    {
      sku_id: "juweel-box",
      sku_code: "JUWEEL-24X33",
      sku_name: "Berlewalde het Juweel - Doos 24 * 33cl",
      beer_name: "Berlewalde het Juweel",
      subject_type: "beer",
      active_anchor: {
        record_id: "active-generation:juweel-box",
        record_kind: "active_planning_anchor",
        authority_status: "target_anchor_verified",
        planning_year: 2026,
        source_anchor_id: "target-anchor",
        source_anchor_kind: "first_activation",
        source_anchor_year: 2026,
        source_anchor_effective_at: "2026-07-16T00:00:00+00:00",
        target_anchor_id: "",
        effective_at: "2026-07-16T00:00:00+00:00",
        cost_method: "inkoop",
        provenance_kind: "recovered_from_exact_target_anchor",
        provenance_source_year: 2026,
        component_state: "ready",
        components: { primary_cost: 17.05, packaging_cost: 0, overhead_cost: 19, excise_cost: 2.07, cost_price: 38.12 },
        cost_blocker_codes: [],
      },
      cost_versions: [
        {
          record_id: "cost-row:anchor",
          record_kind: "cost_version",
          relation_to_anchor: "anchor_source",
          source_year: 2026,
          version_number: 1,
          version_status: "definitief",
          cost_method: "inkoop",
          cost_source: "initial_calculation",
          source_ref: "WIZARD-2026",
          effective_at: "2026-07-16T00:00:00+00:00",
          supplier: "Beerselect",
          component_state: "ready",
          components: { primary_cost: 17.05, packaging_cost: 0, overhead_cost: 19, excise_cost: 2.07, cost_price: 38.12 },
          lots: [{ lot_number: "EV02232", source_type: "purchase_invoice", source_ref: "INV-1", source_date: "2026-07-16", supplier: "Beerselect", resolution_status: "resolved", evidence_kind: "canonical_lot" }],
          unverified_lots: [],
        },
        {
          record_id: "cost-row:later",
          record_kind: "cost_version",
          relation_to_anchor: "registered_variant",
          source_year: 2026,
          version_number: 2,
          version_status: "definitief",
          cost_method: "inkoop",
          cost_source: "purchase_invoice",
          source_ref: "INV-2",
          effective_at: "2026-08-01T00:00:00+00:00",
          supplier: "Beerselect",
          component_state: "ready",
          components: { primary_cost: 18, packaging_cost: 0, overhead_cost: 19, excise_cost: 2.07, cost_price: 39.07 },
          lots: [],
          unverified_lots: [{ lot_number: "EV09999", source_type: "purchase_invoice", source_ref: "INV-2", source_date: "2026-08-01", supplier: "Beerselect", resolution_status: "unresolved", evidence_kind: "version_declared_lot" }],
        },
      ],
      unresolved_evidence: [{ evidence_id: "opening-1", evidence_kind: "direct_lot_without_canonical_lineage", source_type: "opening_stock", source_ref: "OPEN-1", source_date: "2026-01-01", supplier: "", lot_number: "OPEN-LOT", product_name: "Juweel", reason_codes: ["direct_lot_cost_without_canonical_lineage"], components: null }],
      reason_codes: [],
    },
  ],
  reason_codes: [],
};


test.describe("RF-012D3 cost-history screen contract", () => {
  test.skip(!TEST_USERNAME || !TEST_PASSWORD, "Requires TEST_USERNAME/TEST_PASSWORD");

  test("loads history lazily, supports keyboard disclosures and sends no mutations", async ({ page }, testInfo) => {
    await page.route("**/api/meta/commercial-yearsets/active/cost-overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) }));
    await page.route("**/api/meta/commercial-yearsets/active/cost-history", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) }));
    await ensureLoggedIn(page);

    let mutations = 0;
    const listener = (request: { method(): string }) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations += 1;
    };
    page.on("request", listener);

    const historyToggle = page.locator('button[aria-controls="active-cost-history"]');
    await expect(historyToggle).toBeVisible({ timeout: 30_000 });
    await expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    await historyToggle.focus();
    await page.keyboard.press("Enter");
    await expect(historyToggle).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator("#active-cost-history");
    await expect(panel.getByText("2 kostprijsregels", { exact: true })).toBeVisible();
    await expect(panel.getByText("1 aanvullende varianten", { exact: true })).toBeVisible();
    const skuToggle = panel.getByRole("button", { name: /Berlewalde het Juweel - Doos 24 \* 33cl/ });
    await skuToggle.focus();
    await page.keyboard.press("Enter");
    await expect(skuToggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByText("Actief planningsanker 2026", { exact: true })).toBeVisible();
    await expect(panel.getByText("Doeljaaranker 2026 geverifieerd", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Geen bedrag: canonieke kostversielijn ontbreekt/)).toBeVisible();
    await expect(panel.getByText(/LOT EV09999 · niet exact gekoppeld/)).toBeVisible();

    expect(mutations).toBe(0);
    page.off("request", listener);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await testInfo.attach(`cost-history-${testInfo.project.name}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
  });
});
