import path from "node:path";

import type { ProductCostRow } from "../src/components/adviesprijzen/adviesprijzenDerivations";
import type * as DerivationsModule from "../src/components/adviesprijzen/adviesprijzenDerivations";
import type * as FormModelModule from "../src/features/recommended-price/recommendedPriceFormModel";
import type * as ScreenModelModule from "../src/features/recommended-price/recommendedPriceScreenModel";

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

function roundedCents(value: number): number {
  return Math.round(value * 100);
}

function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildAdviesprijzenSavePayload,
    buildProductionYears,
    buildYears,
    buildYearRows,
    normalizeAdviesprijsRows,
    normalizeChannels,
  } = require("../src/components/adviesprijzen/adviesprijzenDerivations") as typeof DerivationsModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildRecommendedPriceDisplayRow,
    getAdviceMarkupInputLabel,
    getDefaultRecommendedPriceYear,
    getRecommendedPriceActionStatus,
    RECOMMENDED_PRICE_PENDING_STATUS,
    RECOMMENDED_PRICE_SAVE_ERROR,
    RECOMMENDED_PRICE_SAVE_SUCCESS,
  } = require("../src/features/recommended-price/recommendedPriceFormModel") as typeof FormModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildRecommendedPriceScreenModel,
    RECOMMENDED_PRICE_DATASET_KEYS,
  } = require("../src/features/recommended-price/recommendedPriceScreenModel") as typeof ScreenModelModule;

  const adviceRows = [{ id: "advice-2026-horeca", jaar: 2026, channel_code: "horeca", opslag_pct: 190 }];
  const model = buildRecommendedPriceScreenModel({
    navigation: [{ key: "advice", label: "Adviesprijzen", description: "", href: "/adviesprijzen", section: "Prijsbeheer" }],
    datasets: {
      channels: [{ id: "horeca" }],
      adviesprijzen: adviceRows,
      productie: { "2025": {}, "2026": {} },
      verkoopprijzen: [{ id: "sales-1" }],
      bieren: [{ id: "beer-1" }],
      skus: [{ id: "sku-1" }],
      articles: [{ id: "article-1" }],
      kostprijsversies: [{ id: "cost-1" }],
      kostprijsproductactiveringen: [{ id: "activation-1" }],
      "packaging-components": [{ id: "packaging-1" }],
      "packaging-component-price-versions": [{ id: "packaging-price-1" }],
    },
  });
  assert(model.navigation.length === 1, "Recommended-price navigation projection changed.");
  assert(model.workspace.initialAdviesprijzen === adviceRows, "Recommended-price rows were copied or transformed by the route.");
  assert(model.workspace.initialKostprijsproductactiveringen[0]?.id === "activation-1", "Activation dataset mapping changed.");
  assert(model.workspace.initialPackagingComponentPriceVersions[0]?.id === "packaging-price-1", "Packaging price-version mapping changed.");
  assert(RECOMMENDED_PRICE_DATASET_KEYS.length === 11, "Recommended-price bootstrap dataset count changed.");

  const emptyModel = buildRecommendedPriceScreenModel({ datasets: {} });
  assert(emptyModel.workspace.initialAdviesprijzen.length === 0, "Missing advice rows no longer project to an empty list.");
  assert(Object.keys(emptyModel.workspace.initialProductie).length === 0, "Missing production data no longer projects to the existing empty state.");

  const channels = normalizeChannels([
    { code: "retail", naam: "Supermarkt", actief: true, volgorde: 2, default_marge_pct: 65 },
    { code: "horeca", naam: "Horeca", actief: true, volgorde: 1, default_marge_pct: 190 },
  ]);
  assert(channels.map((row) => row.code).join(",") === "horeca,retail", "Channel ordering changed.");
  const normalizedRows = normalizeAdviesprijsRows([
    { id: "retail-2025", jaar: "2025", channel_code: "RETAIL", opslag_pct: "65" },
    { id: "invalid", jaar: 0, channel_code: "horeca", opslag_pct: 10 },
  ]);
  assert(normalizedRows.length === 1 && normalizedRows[0]?.channel_code === "retail", "Advice-row normalization changed.");
  assert(JSON.stringify(buildProductionYears({ "2026": {}, invalid: {}, "2025": {} })) === "[2025,2026]", "Production-year projection changed.");
  assert(JSON.stringify(buildYears([2025], [{ ...normalizedRows[0]!, jaar: 2026 }])) === "[2025,2026]", "Advice-only year merge changed.");
  assert(getDefaultRecommendedPriceYear([2025, 2026], 2040) === 2026, "Newest recommended-price year is no longer selected by default.");
  assert(getDefaultRecommendedPriceYear([], 2040) === 2040, "Empty recommended-price year fallback changed.");

  const existing2026 = { id: "horeca-2026", jaar: 2026, channel_code: "horeca", opslag_pct: 190 };
  const prior2025 = { id: "retail-2025", jaar: 2025, channel_code: "retail", opslag_pct: 60 };
  const yearRows = buildYearRows({ rows: [prior2025, existing2026], selectedYear: 2026, activeChannels: channels });
  assert(yearRows[0]?.row === existing2026, "Existing selected-year advice row is no longer retained by reference.");
  assert(yearRows[1]?.row.id === "" && yearRows[1]?.row.opslag_pct === 0, "Missing channel no longer receives the existing zero default.");
  const payload = buildAdviesprijzenSavePayload({ rows: [prior2025, existing2026], selectedYear: 2026, yearRows });
  assert(payload[0] === prior2025, "Rows for another year are no longer kept first and unchanged.");
  assert(payload[1]?.id === existing2026.id && payload[1]?.opslag_pct === 190, "Existing selected-year save payload changed.");
  assert(payload[2]?.channel_code === "retail" && payload[2]?.opslag_pct === 0, "Missing-channel save default changed.");

  const productRow: ProductCostRow = {
    skuId: "sku-1",
    bierId: "beer-1",
    biernaam: "Blond",
    btwPct: 21,
    kostprijsversieId: "",
    productId: "format-1",
    productType: "basis",
    verpakking: "Doos 24 x 33cl",
    kostprijsEx: 10,
  };
  const excl = buildRecommendedPriceDisplayRow({ row: productRow, sellInEx: 15, adviesOpslagPct: 50, vatDisplay: "excl" });
  assert(excl.kostprijsShown === 10 && excl.sellInShown === 15, "Ex-VAT cost/sell-in display changed.");
  assert(roundedCents(excl.adviesMinShown) === 2244 && roundedCents(excl.adviesMaxShown) === 2252, "Ex-VAT advice range changed.");
  assert(roundedCents(excl.margeKlantPct) === 5551, "Customer margin display changed.");
  const incl = buildRecommendedPriceDisplayRow({ row: productRow, sellInEx: 15, adviesOpslagPct: 50, vatDisplay: "incl" });
  assert(roundedCents(incl.kostprijsShown) === 1210 && roundedCents(incl.sellInShown) === 1815, "VAT display conversion changed.");
  assert(roundedCents(incl.adviesMinShown) === 2715 && roundedCents(incl.adviesMaxShown) === 2725, "Incl-VAT advice range changed.");

  assert(getAdviceMarkupInputLabel("Horeca") === "Opslag (%) voor Horeca", "Advice markup accessible name changed.");
  assert(RECOMMENDED_PRICE_SAVE_SUCCESS === "Opgeslagen.", "Success feedback changed.");
  assert(RECOMMENDED_PRICE_SAVE_ERROR === "Opslaan mislukt.", "Failure fallback changed.");
  assert(RECOMMENDED_PRICE_PENDING_STATUS.kind === "pending", "Pending save semantics changed.");
  assert(getRecommendedPriceActionStatus(RECOMMENDED_PRICE_SAVE_SUCCESS, false)?.kind === "success", "Successful save is no longer announced semantically.");
  assert(getRecommendedPriceActionStatus("API request failed", false)?.kind === "error", "Failed save is no longer announced as an error.");
  assert(getRecommendedPriceActionStatus("", false) === null, "Empty status no longer remains hidden.");
}

try {
  run();
  console.log("recommendedPriceScreen contracttest OK (SCREEN-018; RF-012B2)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
