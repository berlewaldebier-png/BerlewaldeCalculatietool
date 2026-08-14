import path from "node:path";

import type { BeerViewRow } from "../src/components/verkoopstrategie/verkoopstrategieTypes";
import type { StrategyRow } from "../src/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import type * as FormModelModule from "../src/features/sales-strategy/salesStrategyFormModel";
import type * as ActiveModelModule from "../src/features/sales-strategy/activeSalesStrategyModel";
import type * as ScreenModelModule from "../src/features/sales-strategy/salesStrategyScreenModel";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installAtAliasResolverForCompiledTests() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require("module") as any;
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const compiledRoot = path.resolve(__dirname, "..");
      const mapped = path.join(compiledRoot, "src", request.slice(2));
      return originalResolveFilename.call(this, mapped, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

function beerRow(overrides: Partial<BeerViewRow> = {}): BeerViewRow {
  return {
    id: "strategy-1",
    skuId: "sku-1",
    bierId: "beer-1",
    biernaam: "Blond",
    productId: "format-1",
    productType: "basis",
    product: "Doos 24 x 33cl",
    kostprijs: 10,
    productOpslags: { list: 50 },
    opslagOverrides: { list: "" },
    sellInPriceOverrides: { list: "" },
    activeOpslags: { list: 50 },
    sellInPrices: { list: 15 },
    sellInPriceSources: { list: "opslag" },
    isReadOnly: false,
    followsProductId: "",
    followsProductLabel: "",
    ...overrides,
  };
}

function strategyRow(overrides: Partial<StrategyRow>): StrategyRow {
  return {
    id: "strategy-1",
    record_type: "verkoopstrategie_product",
    jaar: 2026,
    sku_id: "",
    bier_id: "beer-1",
    biernaam: "Blond",
    product_id: "format-1",
    product_type: "basis",
    verpakking: "Doos 24 x 33cl",
    strategie_type: "override",
    kostprijs: 10,
    sell_in_margins: { list: 50, horeca: "" },
    sell_in_prices: { list: 15, horeca: "" },
    _uiId: "ui-only",
    ...overrides,
  };
}

function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildSalesStrategySavePayload,
    buildStrategySkuLookups,
    filterAndGroupSalesStrategyRows,
    getDefaultSalesStrategyYear,
    getProductionYears,
    getSalesStrategyActionStatus,
    getSalesStrategyListOpslag,
    getSalesStrategyListPrice,
    getSalesStrategyStatusForSelectedYear,
    getSalesStrategyYearOptions,
    hasSalesStrategyForYear,
    SALES_STRATEGY_DRAFT_SUCCESS,
    SALES_STRATEGY_PENDING_STATUS,
    SALES_STRATEGY_SAVE_ERROR,
    SALES_STRATEGY_SERVER_SUCCESS,
  } = require("../src/features/sales-strategy/salesStrategyFormModel") as typeof FormModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildSalesStrategyScreenModel,
  } = require("../src/features/sales-strategy/salesStrategyScreenModel") as typeof ScreenModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    activeSalesStrategyMarkup,
    activeSalesStrategyStatusLabel,
    filterActiveSalesStrategyGroups,
  } = require("../src/features/sales-strategy/activeSalesStrategyModel") as typeof ActiveModelModule;

  const navigation = [{ key: "sales", label: "Verkoopstrategie", description: "", href: "/verkoopstrategie", section: "Prijsbeheer" }];
  const activeItem = {
    sku_id: "sku-1",
    sku_code: "BLOND-24",
    sku_name: "Berlewalde Blond - Doos 24 x 33cl",
    beer_name: "Berlewalde Blond",
    canonical_beer_id: "beer-1",
    subject_type: "beer",
    subject_id: "beer-1",
    sku_kind: "composite",
    scope_classification: "carried_forward",
    cost_price: 10,
    cost_state: "ready" as const,
    cost_blocker_codes: [],
    activation_list_price: 15,
    list_price: 16,
    price_state: "ready" as const,
    price_required: true,
    price_reason_codes: [],
    pricing_record_id: "price-1",
    pricing_record_hash: "hash-1",
    pricing_updated_at: "2026-01-01T00:00:00Z",
    target_pricing_id: "price-1",
    price_source: "target_record" as const,
    editable: true,
    display_priority: 0,
  };
  const projection = {
    version: "rf-012c4a-v1",
    status: "ready" as const,
    read_only: false,
    can_edit: true,
    binding: {
      generation_id: "generation-2026",
      run_id: "run-2026",
      operational_year: 2026,
      manifest_hash: "manifest-2026",
      validation_hash: "validation-2026",
    },
    groups: [{ key: "beer:beer-1", label: "Berlewalde Blond", kind: "beer", priority: 0, items: [activeItem] }],
    summary: {
      sku_count: 1,
      group_count: 1,
      ready_price_count: 1,
      missing_price_count: 0,
      non_positive_price_count: 0,
      ambiguous_price_count: 0,
      not_applicable_price_count: 0,
      compatibility_only_price_count: 0,
    },
    reason_codes: [],
  };
  const model = buildSalesStrategyScreenModel(navigation, projection);
  assert(model.navigation.length === 1, "Sales-strategy navigation projection changed.");
  assert(model.projection === projection, "The route no longer preserves the active-generation projection.");
  assert(model.projection.binding?.operational_year === 2026, "The active operational year changed.");
  assert(Math.abs(Number(activeSalesStrategyMarkup(activeItem, 16)) - 60) < 1e-9, "Active SKU markup calculation changed.");
  assert(activeSalesStrategyStatusLabel(activeItem) === "prijs gezet", "Ready price status changed.");
  assert(filterActiveSalesStrategyGroups(projection.groups, "blond").length === 1, "Active SKU search changed.");
  assert(filterActiveSalesStrategyGroups(projection.groups, "tripel").length === 0, "Active SKU search includes unrelated groups.");

  assert(JSON.stringify(getProductionYears([{ jaar: 2026 }, { jaar: "2025" }, { jaar: 2026 }, { jaar: 0 }])) === "[2025,2026]", "Array production-year projection changed.");
  assert(JSON.stringify(getProductionYears({ "2027": {}, invalid: {}, "2026": {} })) === "[2026,2027]", "Object production-year projection changed.");
  assert(getDefaultSalesStrategyYear([2025, 2026], 2040) === 2026, "Newest production year is no longer the default.");
  assert(getDefaultSalesStrategyYear([], 2040) === 2040, "Empty production years no longer retain the current-year empty-state value.");
  assert(JSON.stringify(getSalesStrategyYearOptions([2025, 2027, 2026])) === "[2027,2026,2025]", "Year option ordering changed.");

  const derivedPriceRow = beerRow();
  assert(getSalesStrategyListPrice(derivedPriceRow) === 15, "Derived list price display changed.");
  assert(getSalesStrategyListOpslag(derivedPriceRow) === 50, "Visible opslag calculation changed.");
  const explicitPriceRow = beerRow({ sellInPriceOverrides: { list: 16.25 }, sellInPrices: { list: 15 } });
  assert(getSalesStrategyListPrice(explicitPriceRow) === 16.25, "Explicit list price no longer wins in the screen.");
  assert(getSalesStrategyListOpslag(beerRow({ kostprijs: 0 })) === 0, "Zero-cost opslag guard changed.");

  const grouped = filterAndGroupSalesStrategyRows([
    beerRow({ biernaam: "Tripel", product: "Fust 20L" }),
    beerRow({ biernaam: "Blond", product: "Fles 33cl", skuId: "sku-2", productId: "format-2" }),
    beerRow({ biernaam: "Blond", product: "Doos 24 x 33cl" }),
  ], "blond");
  assert(grouped.length === 1 && grouped[0]?.biernaam === "Blond", "Beer/product search behavior changed.");
  assert(grouped[0]?.rows[0]?.product === "Doos 24 x 33cl", "Product ordering within a beer changed.");

  const lookups = buildStrategySkuLookups([
    { id: "sku-beer-format", kind: "beer_format", beer_id: "beer-1", format_article_id: "format-1" },
    { id: "sku-article", kind: "article", article_id: "bundle-1" },
  ]);
  const passthrough = { id: "product-pricing-1", record_type: "product_pricing", retained: true };
  const payload = buildSalesStrategySavePayload({
    passthroughRows: [passthrough],
    strategyRows: [
      strategyRow({}),
      strategyRow({
        id: "strategy-2",
        record_type: "verkoopstrategie_verpakking",
        bier_id: "",
        biernaam: "",
        product_id: "bundle-1",
        product_type: "samengesteld",
      }),
      strategyRow({ id: "strategy-3", sku_id: "sku-existing" }),
    ],
    skuLookups: lookups,
  });
  assert(payload[0] === passthrough, "Non-strategy price records are no longer preserved first and unchanged.");
  assert(payload[1]?.sku_id === "sku-beer-format", "Beer-format SKU identity enrichment changed.");
  assert(payload[2]?.sku_id === "sku-article", "Article SKU identity enrichment changed.");
  assert(payload[3]?.sku_id === "sku-existing", "Existing SKU identity is no longer preserved.");
  assert(!("_uiId" in payload[1]), "UI-only strategy identity leaked into the payload.");
  assert((payload[1]?.sell_in_margins as Record<string, unknown>)?.list === 50, "List opslag changed in the save payload.");
  assert(!("horeca" in (payload[1]?.sell_in_margins as Record<string, unknown>)), "Inherited empty opslag is no longer omitted.");
  assert((payload[1]?.kanaalprijzen as Record<string, unknown>)?.list === 15, "Legacy channel-price compatibility field changed.");

  assert(SALES_STRATEGY_SERVER_SUCCESS === "Opgeslagen.", "Server success feedback changed.");
  assert(SALES_STRATEGY_DRAFT_SUCCESS === "Concept opgeslagen.", "Draft success feedback changed.");
  assert(SALES_STRATEGY_SAVE_ERROR === "Opslaan mislukt.", "Failure feedback changed.");
  assert(SALES_STRATEGY_PENDING_STATUS.kind === "pending", "Pending save semantics changed.");
  assert(getSalesStrategyActionStatus(SALES_STRATEGY_SERVER_SUCCESS, false)?.kind === "success", "Successful save is no longer announced semantically.");
  assert(getSalesStrategyActionStatus(SALES_STRATEGY_SAVE_ERROR, false)?.kind === "error", "Failed save is no longer announced as an error.");
  assert(getSalesStrategyActionStatus("Jaarstrategie voor 2026 ontbreekt.", false)?.kind === "warning", "Missing year-strategy warning semantics changed.");
  assert(getSalesStrategyActionStatus("", false) === null, "Empty status no longer remains hidden.");
  const missing2025Status = "Jaarstrategie voor 2025 ontbreekt. Defaults zijn klaar gezet; klik Opslaan om te bewaren.";
  const missing2026Status = "Jaarstrategie voor 2026 ontbreekt. Defaults zijn klaar gezet; klik Opslaan om te bewaren.";
  assert(hasSalesStrategyForYear([strategyRow({ record_type: "jaarstrategie", jaar: 2026 })], 2026), "Existing year strategy is no longer detected.");
  assert(!hasSalesStrategyForYear([strategyRow({ record_type: "jaarstrategie", jaar: 2025 })], 2026), "A different year's strategy is treated as current.");
  assert(getSalesStrategyStatusForSelectedYear(missing2025Status, 2025, true) === missing2025Status, "Current-year strategy warning is no longer retained.");
  assert(getSalesStrategyStatusForSelectedYear(missing2025Status, 2026, false) === "", "Previous-year strategy warning remains visible after changing year.");
  assert(getSalesStrategyStatusForSelectedYear(missing2025Status, 2026, true) === missing2026Status, "Missing strategy warning is not rebuilt for the newly selected year.");
  assert(getSalesStrategyStatusForSelectedYear(SALES_STRATEGY_SERVER_SUCCESS, 2026) === SALES_STRATEGY_SERVER_SUCCESS, "Non-year-specific status feedback is cleared unexpectedly.");
}

try {
  run();
  console.log("salesStrategyScreen contracttest OK (SCREEN-017; RF-012C4A + draft compatibility)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
