import path from "node:path";

import type { BeerViewRow } from "../src/components/verkoopstrategie/verkoopstrategieTypes";
import type { StrategyRow } from "../src/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import type * as FormModelModule from "../src/features/sales-strategy/salesStrategyFormModel";
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
    SALES_STRATEGY_DATASET_KEYS,
  } = require("../src/features/sales-strategy/salesStrategyScreenModel") as typeof ScreenModelModule;

  const verkoopprijzen = [{ id: "strategy-existing" }];
  const model = buildSalesStrategyScreenModel({
    navigation: [{ key: "sales", label: "Verkoopstrategie", description: "", href: "/verkoopstrategie", section: "Prijsbeheer" }],
    datasets: {
      productie: { "2025": {}, "2026": {} },
      verkoopprijzen,
      basisproducten: [{ id: "base-1" }],
      "samengestelde-producten": [{ id: "bundle-1" }],
      bieren: [{ id: "beer-1" }],
      skus: [{ id: "sku-1" }],
      articles: [{ id: "format-1" }],
      "bom-lines": [{ id: "line-1" }],
      berekeningen: [{ id: "cost-1" }],
      channels: [{ id: "horeca" }],
      kostprijsproductactiveringen: [{ id: "activation-1" }],
    },
  });
  assert(model.navigation.length === 1, "Sales-strategy navigation projection changed.");
  assert(model.workspace.endpoint === "/data/verkoopprijzen", "Sales-strategy save endpoint changed.");
  assert(model.workspace.verkoopprijzen === verkoopprijzen, "Sales-strategy price rows were copied or transformed by the route.");
  assert(model.workspace.bomLines?.[0]?.id === "line-1", "BOM dataset mapping changed.");
  assert(model.workspace.kostprijsproductactiveringen[0]?.id === "activation-1", "Activation dataset mapping changed.");
  assert(SALES_STRATEGY_DATASET_KEYS.length === 11, "Sales-strategy bootstrap dataset count changed.");

  const emptyModel = buildSalesStrategyScreenModel({ datasets: {} });
  assert(emptyModel.workspace.verkoopprijzen.length === 0, "Missing price rows no longer project to an empty list.");
  assert(emptyModel.workspace.productie !== null, "Missing production data no longer projects to the existing empty state.");

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
  console.log("salesStrategyScreen contracttest OK (SCREEN-017; RF-012B1)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
