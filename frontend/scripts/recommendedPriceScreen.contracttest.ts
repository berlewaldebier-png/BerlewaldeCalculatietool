import path from "node:path";

import type * as ActiveModelModule from "../src/features/recommended-price/activeRecommendedPriceModel";
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

function roundedCents(value: number | null): number {
  return Math.round(Number(value ?? 0) * 100);
}

function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    activeRecommendedPriceStatusLabel,
    buildActiveRecommendedPriceDisplayRow,
    filterActiveRecommendedPriceGroups,
  } = require("../src/features/recommended-price/activeRecommendedPriceModel") as typeof ActiveModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    getAdviceMarkupInputLabel,
    getRecommendedPriceActionStatus,
    RECOMMENDED_PRICE_PENDING_STATUS,
    RECOMMENDED_PRICE_SAVE_ERROR,
    RECOMMENDED_PRICE_SAVE_SUCCESS,
  } = require("../src/features/recommended-price/recommendedPriceFormModel") as typeof FormModelModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildRecommendedPriceScreenModel } = require(
    "../src/features/recommended-price/recommendedPriceScreenModel"
  ) as typeof ScreenModelModule;

  const projection: ActiveModelModule.ActiveRecommendedPriceProjection = {
    version: "rf-012c4b-v1",
    status: "ready",
    read_only: false,
    can_edit: true,
    binding: {
      generation_id: "generation-2026",
      run_id: "run-2026",
      operational_year: 2026,
      manifest_hash: "manifest-2026",
      validation_hash: "validation-2026",
    },
    channels: [{
      channel_code: "horeca",
      channel_name: "Horeca",
      order: 1,
      activation_advice_markup_pct: 190,
      advice_markup_pct: 190,
      markup_state: "ready",
      reason_codes: [],
      pricing_record_id: "advice-horeca",
      pricing_record_hash: "hash-horeca",
      pricing_updated_at: "2026-01-01T00:00:00Z",
      editable: true,
    }],
    groups: [{
      key: "beer:blond",
      label: "Berlewalde Blond",
      kind: "beer",
      priority: 0,
      items: [{
        sku_id: "sku-blond",
        sku_code: "BLOND-24",
        sku_name: "Berlewalde Blond - Doos 24 x 33cl",
        beer_name: "Berlewalde Blond",
        canonical_beer_id: "beer-blond",
        subject_type: "beer",
        subject_id: "beer-blond",
        sku_kind: "composite",
        scope_classification: "carried_forward",
        cost_price: 10,
        cost_state: "ready",
        list_price: 15,
        price_state: "ready",
        price_required: true,
        vat_pct: 21,
        vat_state: "ready",
        advice_state: "ready",
        advice_reason_codes: [],
      }],
    }],
    summary: {
      sku_count: 1,
      group_count: 1,
      channel_count: 1,
      ready_advice_sku_count: 1,
      missing_cost_count: 0,
      missing_sell_in_count: 0,
      missing_vat_count: 0,
      not_applicable_count: 0,
      missing_channel_markup_count: 0,
    },
    reason_codes: [],
  };

  const navigation = [{ key: "advice", label: "Adviesprijzen", description: "", href: "/adviesprijzen", section: "Prijsbeheer" }];
  const model = buildRecommendedPriceScreenModel(navigation, projection);
  assert(model.navigation === navigation, "Recommended-price navigation is no longer passed through.");
  assert(model.workspace.initialProjection === projection, "Active recommended-price projection was copied or replaced.");

  const item = projection.groups[0]!.items[0]!;
  const excl = buildActiveRecommendedPriceDisplayRow({
    item,
    ownerLabel: projection.groups[0]!.label,
    adviceMarkupPct: 50,
    vatDisplay: "excl",
  });
  assert(excl.status === "ready", "A complete active SKU no longer produces an advice price.");
  assert(excl.kostprijsShown === 10 && excl.sellInShown === 15, "Ex-VAT cost/sell-in display changed.");
  assert(roundedCents(excl.adviesMinShown) === 2244 && roundedCents(excl.adviesMaxShown) === 2252, "Ex-VAT five-cent advice range changed.");
  assert(roundedCents(excl.margeKlantPct) === 5551, "Customer margin display changed.");
  const incl = buildActiveRecommendedPriceDisplayRow({
    item,
    ownerLabel: projection.groups[0]!.label,
    adviceMarkupPct: 50,
    vatDisplay: "incl",
  });
  assert(roundedCents(incl.kostprijsShown) === 1210 && roundedCents(incl.sellInShown) === 1815, "VAT display conversion changed.");
  assert(roundedCents(incl.adviesMinShown) === 2715 && roundedCents(incl.adviesMaxShown) === 2725, "Incl-VAT advice range changed.");

  const missingVat = buildActiveRecommendedPriceDisplayRow({
    item: { ...item, vat_pct: null, vat_state: "missing", advice_state: "missing_vat" },
    ownerLabel: "Samengestelde producten",
    adviceMarkupPct: 50,
    vatDisplay: "incl",
  });
  assert(missingVat.status === "missing_vat" && missingVat.adviesMinShown === null, "Missing VAT is no longer fail-closed.");
  const missingSellIn = buildActiveRecommendedPriceDisplayRow({
    item: { ...item, list_price: null, price_state: "missing", advice_state: "missing_sell_in" },
    ownerLabel: "Berlewalde Blond",
    adviceMarkupPct: 50,
    vatDisplay: "excl",
  });
  assert(missingSellIn.status === "missing_sell_in" && missingSellIn.adviesMinShown === null, "Missing active sell-in is no longer visible.");
  assert(activeRecommendedPriceStatusLabel("missing_sell_in") === "sell-inprijs ontbreekt", "Typed sell-in warning changed.");

  assert(filterActiveRecommendedPriceGroups(projection.groups, "BLOND-24").length === 1, "SKU-code search changed.");
  assert(filterActiveRecommendedPriceGroups(projection.groups, "niet-bestaand").length === 0, "Empty search state changed.");
  assert(getAdviceMarkupInputLabel("Horeca") === "Opslag (%) voor Horeca", "Advice markup accessible name changed.");
  assert(RECOMMENDED_PRICE_SAVE_SUCCESS === "Opgeslagen.", "Legacy success constant changed.");
  assert(RECOMMENDED_PRICE_SAVE_ERROR === "Opslaan mislukt.", "Legacy failure constant changed.");
  assert(RECOMMENDED_PRICE_PENDING_STATUS.kind === "pending", "Pending save semantics changed.");
  assert(getRecommendedPriceActionStatus(RECOMMENDED_PRICE_SAVE_SUCCESS, false)?.kind === "success", "Successful save is no longer announced semantically.");
  assert(getRecommendedPriceActionStatus("API request failed", false)?.kind === "error", "Failed save is no longer announced as an error.");
}

try {
  run();
  console.log("recommendedPriceScreen contracttest OK (SCREEN-018; RF-012C4B)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
